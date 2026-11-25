import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { admissionRules, admissions, branches, courseAssignments, courses, courseVersions, lessonProgress, testAttempts, trainingFiles, users } from "../../db/schema.ts";
import { loadCompanyBranch, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, requireRole, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { isUniqueViolation, newId } from "../db.ts";
import { AppError, badRequest, readJson, str } from "../http.ts";
import {
    applyAdmissionRules,
    assignedCourseIds,
    companyRules,
    evaluateRules,
    latestVersion,
    markRulesCustomized,
    parseStoredContent,
    publicQuestions,
    rulesForBranch,
    sanitizeAnswers,
    scoreAnswers,
    type CourseContent,
} from "../training.ts";

const isStaff = (actor: Actor) => actor.role === "director" || actor.role === "manager";

/** Доступ к курсу: назначен человеку, либо это руководитель/директор той же компании */
async function loadAccessibleCourse(ctx: Ctx, actor: Actor, courseId: string) {
    const course = await ctx.db.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.companyId, actor.companyId))).get();
    if (!course) throw new AppError(404, "training.courseNotFound");
    if (isStaff(actor)) return { course, requiredMin: null as number | null };
    const assigned = await assignedCourseIds(ctx.db, { id: actor.userId, companyId: actor.companyId, role: actor.role, branchId: actor.branchId });
    const entry = assigned.get(course.id);
    // Не назначенный курс выглядит как несуществующий.
    if (!entry) throw new AppError(404, "training.courseNotFound");
    return { course, requiredMin: entry.requiredMin };
}

function progressFor(content: CourseContent, done: Set<string>) {
    const total = content.lessons.length;
    const completed = content.lessons.filter((lesson) => done.has(lesson.key)).length;
    return { total, completed, percent: total ? Math.floor((completed * 100) / total) : 0 };
}

async function completedLessons(ctx: Ctx, userId: string, courseIds: string[]) {
    if (!courseIds.length) return new Map<string, Set<string>>();
    const rows = await ctx.db
        .select({ courseId: lessonProgress.courseId, lessonKey: lessonProgress.lessonKey })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, userId), inArray(lessonProgress.courseId, courseIds)))
        .all();
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
        if (!map.has(row.courseId)) map.set(row.courseId, new Set());
        map.get(row.courseId)!.add(row.lessonKey);
    }
    return map;
}

async function attemptSummaries(ctx: Ctx, userIds: string[], courseIds: string[]) {
    if (!userIds.length || !courseIds.length) return [];
    return ctx.db
        .select({
            id: testAttempts.id,
            userId: testAttempts.userId,
            courseId: testAttempts.courseId,
            status: testAttempts.status,
            scorePercent: testAttempts.scorePercent,
            passed: testAttempts.passed,
            submittedAt: testAttempts.submittedAt,
            startedAt: testAttempts.startedAt,
            version: courseVersions.version,
        })
        .from(testAttempts)
        .innerJoin(courseVersions, eq(courseVersions.id, testAttempts.courseVersionId))
        .where(and(inArray(testAttempts.userId, userIds), inArray(testAttempts.courseId, courseIds)))
        .orderBy(desc(testAttempts.startedAt))
        .all();
}

// --- Сотрудник: мои курсы ------------------------------------------------

export async function myCourses(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const user = { id: actor.userId, companyId: actor.companyId, role: actor.role, branchId: actor.branchId };
    const rules = await companyRules(ctx.db, actor.companyId);
    const assigned = await assignedCourseIds(ctx.db, user, rules);
    const ids = [...assigned.keys()];
    const courseRows = ids.length ? await ctx.db.select().from(courses).where(inArray(courses.id, ids)).orderBy(courses.title).all() : [];
    const done = await completedLessons(ctx, actor.userId, ids);
    const attempts = await attemptSummaries(ctx, [actor.userId], ids);

    const items = [];
    for (const course of courseRows) {
        const version = await latestVersion(ctx.db, course.id);
        if (!version) continue;
        const content = parseStoredContent(version.content);
        const own = attempts.filter((attempt) => attempt.courseId === course.id);
        const submitted = own.filter((attempt) => attempt.status === "submitted");
        const open = own.find((attempt) => attempt.status === "in_progress") ?? null;
        const best = submitted.reduce<number | null>((max, attempt) => (attempt.scorePercent !== null && (max === null || attempt.scorePercent > max) ? attempt.scorePercent : max), null);
        const requiredMin = assigned.get(course.id)?.requiredMin ?? null;
        items.push({
            id: course.id,
            key: course.key,
            title: version.title,
            description: version.description,
            version: version.version,
            lessons: progressFor(content, done.get(course.id) ?? new Set()),
            questions: content.test.questions.length,
            requiredForAdmission: requiredMin !== null,
            minScorePercent: requiredMin ?? content.test.passPercent,
            bestPercent: best,
            passed: best !== null && best >= (requiredMin ?? content.test.passPercent),
            attempts: submitted.length,
            openAttempt: open ? { id: open.id, version: open.version } : null,
        });
    }
    const evaluation = await evaluateRules(ctx.db, user);
    return {
        courses: items,
        admission: {
            admitted: actor.admitted,
            rules: evaluation,
            /** Правила ссылаются на курс, которого ещё нет: допуск по тесту пока невозможен */
            missingCourses: evaluation.filter((rule) => !rule.courseAvailable).map((rule) => rule.courseKey),
        },
    };
}

export async function courseDetail(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const { course, requiredMin } = await loadAccessibleCourse(ctx, actor, ctx.params["id"] ?? "");
    const version = await latestVersion(ctx.db, course.id);
    if (!version) throw new AppError(404, "training.courseNotFound");
    const content = parseStoredContent(version.content);
    const done = (await completedLessons(ctx, actor.userId, [course.id])).get(course.id) ?? new Set<string>();
    const fileIds = [...new Set(content.lessons.flatMap((lesson) => lesson.fileIds))];
    const files = fileIds.length
        ? await ctx.db
              .select({ id: trainingFiles.id, filename: trainingFiles.filename, contentType: trainingFiles.contentType, size: trainingFiles.size })
              .from(trainingFiles)
              .where(and(eq(trainingFiles.courseId, course.id), inArray(trainingFiles.id, fileIds)))
              .all()
        : [];
    const fileMap = new Map(files.map((file) => [file.id, file]));
    const open = await ctx.db
        .select({ id: testAttempts.id, version: courseVersions.version })
        .from(testAttempts)
        .innerJoin(courseVersions, eq(courseVersions.id, testAttempts.courseVersionId))
        .where(and(eq(testAttempts.userId, actor.userId), eq(testAttempts.courseId, course.id), eq(testAttempts.status, "in_progress")))
        .get();
    return {
        course: {
            id: course.id,
            key: course.key,
            title: version.title,
            description: version.description,
            version: version.version,
            minScorePercent: requiredMin ?? content.test.passPercent,
            requiredForAdmission: requiredMin !== null,
            questions: content.test.questions.length,
            progress: progressFor(content, done),
            lessons: content.lessons.map((lesson) => ({
                key: lesson.key,
                title: lesson.title,
                body: lesson.body,
                durationMinutes: lesson.durationMinutes,
                completed: done.has(lesson.key),
                files: lesson.fileIds.map((id) => fileMap.get(id)).filter(Boolean),
            })),
            openAttempt: open ?? null,
        },
    };
}

export async function completeLesson(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const { course } = await loadAccessibleCourse(ctx, actor, ctx.params["id"] ?? "");
    const version = await latestVersion(ctx.db, course.id);
    if (!version) throw new AppError(404, "training.courseNotFound");
    const lessonKey = ctx.params["lessonKey"] ?? "";
    const content = parseStoredContent(version.content);
    if (!content.lessons.some((lesson) => lesson.key === lessonKey)) throw new AppError(404, "training.lessonNotFound");
    await ctx.db
        .insert(lessonProgress)
        .values({ userId: actor.userId, courseId: course.id, lessonKey, courseVersionId: version.id, completedAt: ctx.now })
        .onConflictDoNothing();
    return { ok: true };
}

// --- Тест ----------------------------------------------------------------

async function attemptPayload(ctx: Ctx, attempt: typeof testAttempts.$inferSelect) {
    const version = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, attempt.courseVersionId)).get();
    if (!version) throw new AppError(500, "error.internal");
    const latest = await latestVersion(ctx.db, attempt.courseId);
    const content = parseStoredContent(version.content);
    return {
        attempt: {
            id: attempt.id,
            courseId: attempt.courseId,
            status: attempt.status,
            version: version.version,
            latestVersion: latest?.version ?? version.version,
            title: version.title,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            questions: publicQuestions(content),
            answers: JSON.parse(attempt.answers) as Record<string, string[]>,
            result:
                attempt.status === "submitted"
                    ? { correct: attempt.correctCount, total: attempt.totalCount, percent: attempt.scorePercent, minScorePercent: attempt.minScorePercent, passed: attempt.passed }
                    : null,
        },
    };
}

/** Начать тест или продолжить незавершённую попытку (по её версии) */
export async function startAttempt(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const { course } = await loadAccessibleCourse(ctx, actor, ctx.params["id"] ?? "");
    const findOpen = () =>
        ctx.db
            .select()
            .from(testAttempts)
            .where(and(eq(testAttempts.userId, actor.userId), eq(testAttempts.courseId, course.id), eq(testAttempts.status, "in_progress")))
            .get();
    const open = await findOpen();
    if (open) return { resumed: true, ...(await attemptPayload(ctx, open)) };
    const version = await latestVersion(ctx.db, course.id);
    if (!version) throw new AppError(404, "training.courseNotFound");
    const id = newId();
    try {
        await ctx.db.insert(testAttempts).values({
            id,
            companyId: actor.companyId,
            userId: actor.userId,
            branchId: actor.branchId,
            courseId: course.id,
            courseVersionId: version.id,
            status: "in_progress",
            answers: "{}",
            startedAt: ctx.now,
        });
    } catch (error) {
        // Двойное нажатие «Начать тест»: вторая попытка не создаётся, возвращаем первую.
        if (!isUniqueViolation(error)) throw error;
        const existing = await findOpen();
        if (!existing) throw error;
        return { resumed: true, ...(await attemptPayload(ctx, existing)) };
    }
    const created = await ctx.db.select().from(testAttempts).where(eq(testAttempts.id, id)).get();
    return { resumed: false, ...(await attemptPayload(ctx, created!)) };
}

async function loadOwnAttempt(ctx: Ctx, actor: Actor) {
    const attempt = await ctx.db
        .select()
        .from(testAttempts)
        .where(and(eq(testAttempts.id, ctx.params["id"] ?? ""), eq(testAttempts.userId, actor.userId)))
        .get();
    if (!attempt) throw new AppError(404, "training.attemptNotFound");
    return attempt;
}

export async function getAttempt(ctx: Ctx) {
    const actor = await requireActor(ctx);
    return attemptPayload(ctx, await loadOwnAttempt(ctx, actor));
}

/** Автосохранение ответов: после перезагрузки страницы ответы не теряются */
export async function saveAnswers(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const attempt = await loadOwnAttempt(ctx, actor);
    if (attempt.status !== "in_progress") throw new AppError(409, "training.attemptClosed");
    const version = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, attempt.courseVersionId)).get();
    const body = await readJson(ctx.request);
    const answers = sanitizeAnswers(parseStoredContent(version!.content), body["answers"]);
    await ctx.db
        .update(testAttempts)
        .set({ answers: JSON.stringify(answers) })
        .where(and(eq(testAttempts.id, attempt.id), eq(testAttempts.status, "in_progress")));
    return { ok: true };
}

/**
 * Сдача теста. Оценивается по версии, закреплённой при старте.
 * Повторная отправка возвращает уже сохранённый результат.
 */
export async function submitAttempt(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const attempt = await loadOwnAttempt(ctx, actor);
    if (attempt.status === "submitted") {
        return { repeated: true, admission: await applyAdmissionRules(ctx.db, actor.userId, ctx.now, null), ...(await attemptPayload(ctx, attempt)) };
    }
    const version = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, attempt.courseVersionId)).get();
    const content = parseStoredContent(version!.content);
    const body = await readJson(ctx.request);
    const answers = sanitizeAnswers(content, body["answers"] ?? JSON.parse(attempt.answers));
    const score = scoreAnswers(content, answers);

    const course = await ctx.db.select().from(courses).where(eq(courses.id, attempt.courseId)).get();
    const rule = rulesForBranch(await companyRules(ctx.db, actor.companyId), actor.branchId).find((item) => item.courseKey === course?.key);
    const minScorePercent = rule?.minScorePercent ?? content.test.passPercent;

    const updated = await ctx.db
        .update(testAttempts)
        .set({
            status: "submitted",
            answers: JSON.stringify(answers),
            submittedAt: ctx.now,
            correctCount: score.correct,
            totalCount: score.total,
            scorePercent: score.percent,
            minScorePercent,
            passed: score.percent >= minScorePercent,
        })
        .where(and(eq(testAttempts.id, attempt.id), eq(testAttempts.status, "in_progress")))
        .returning({ id: testAttempts.id });
    const saved = await ctx.db.select().from(testAttempts).where(eq(testAttempts.id, attempt.id)).get();
    if (updated.length === 0) {
        return { repeated: true, admission: await applyAdmissionRules(ctx.db, actor.userId, ctx.now, null), ...(await attemptPayload(ctx, saved!)) };
    }
    const admission = await applyAdmissionRules(ctx.db, actor.userId, ctx.now, attempt.id);
    await audit(
        ctx.db,
        {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: "training.submit",
            entityType: "test_attempt",
            entityId: attempt.id,
            data: { percent: score.percent, passed: score.percent >= minScorePercent, version: version!.version, admissionGranted: admission.granted },
        },
        ctx.now
    );
    return { repeated: false, admission, ...(await attemptPayload(ctx, saved!)) };
}

// --- Файлы материалов ----------------------------------------------------

const INLINE_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav))$/;

export async function downloadFile(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const file = await ctx.db
        .select()
        .from(trainingFiles)
        .where(and(eq(trainingFiles.id, ctx.params["id"] ?? ""), eq(trainingFiles.companyId, actor.companyId)))
        .get();
    if (!file) throw new AppError(404, "training.fileNotFound");
    // Права: файл доступен только тем, кому доступен его курс.
    await loadAccessibleCourse(ctx, actor, file.courseId);
    if (!ctx.env.BUCKET) throw new AppError(503, "integration.noBucket");
    const object = await ctx.env.BUCKET.get(file.objectKey);
    if (!object) throw new AppError(404, "training.fileNotFound");
    const inline = INLINE_TYPES.test(file.contentType);
    return new Response(object.body, {
        headers: {
            "content-type": inline ? file.contentType : "application/octet-stream",
            "content-length": String(file.size),
            "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
        },
    });
}

// --- Руководитель и директор ---------------------------------------------

/** Прогресс и результаты сотрудников филиала (директор — любого филиала или всех) */
export async function teamProgress(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const scope = await resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true });
    const conditions = [eq(users.companyId, actor.companyId), eq(users.role, "employee"), eq(users.status, "active")];
    if (scope.kind === "one") conditions.push(eq(users.branchId, scope.branchId));
    const people = await ctx.db
        .select({ id: users.id, displayName: users.displayName, login: users.login, branchId: users.branchId, branchName: branches.name })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.branchId))
        .where(and(...conditions))
        .orderBy(users.displayName)
        .all();
    const rules = await companyRules(ctx.db, actor.companyId);
    const admittedIds = new Set(
        people.length
            ? (
                  await ctx.db
                      .select({ userId: admissions.userId })
                      .from(admissions)
                      .where(and(inArray(admissions.userId, people.map((person) => person.id)), isNull(admissions.revokedAt)))
                      .all()
              ).map((row) => row.userId)
            : []
    );
    const versionCache = new Map<string, { title: string; version: number; content: CourseContent } | null>();
    const rows = [];
    for (const person of people) {
        const assigned = await assignedCourseIds(ctx.db, { id: person.id, companyId: actor.companyId, role: "employee", branchId: person.branchId }, rules);
        const ids = [...assigned.keys()];
        const done = await completedLessons(ctx, person.id, ids);
        const attempts = await attemptSummaries(ctx, [person.id], ids);
        const evaluation = await evaluateRules(ctx.db, { id: person.id, companyId: actor.companyId, role: "employee", branchId: person.branchId });
        const coursesInfo = [];
        for (const courseId of ids) {
            if (!versionCache.has(courseId)) {
                const version = await latestVersion(ctx.db, courseId);
                versionCache.set(courseId, version ? { title: version.title, version: version.version, content: parseStoredContent(version.content) } : null);
            }
            const version = versionCache.get(courseId);
            if (!version) continue;
            const own = attempts.filter((attempt) => attempt.courseId === courseId);
            const submitted = own.filter((attempt) => attempt.status === "submitted");
            const best = submitted.reduce<number | null>((max, attempt) => (attempt.scorePercent !== null && (max === null || attempt.scorePercent > max) ? attempt.scorePercent : max), null);
            const last = submitted[0] ?? null;
            const minScore = assigned.get(courseId)?.requiredMin ?? version.content.test.passPercent;
            coursesInfo.push({
                courseId,
                title: version.title,
                lessons: progressFor(version.content, done.get(courseId) ?? new Set()),
                attempts: submitted.length,
                inProgress: own.some((attempt) => attempt.status === "in_progress"),
                bestPercent: best,
                lastPercent: last?.scorePercent ?? null,
                lastSubmittedAt: last?.submittedAt ?? null,
                lastVersion: last?.version ?? null,
                minScorePercent: minScore,
                passed: best !== null && best >= minScore,
            });
        }
        rows.push({ ...person, admitted: admittedIds.has(person.id), courses: coursesInfo, rules: evaluation });
    }
    return { employees: rows };
}

/** Каталог курсов компании с историей версий (для руководителя и директора) */
export async function catalog(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const rows = await ctx.db.select().from(courses).where(eq(courses.companyId, actor.companyId)).orderBy(courses.title).all();
    const versions = rows.length
        ? await ctx.db
              .select({ id: courseVersions.id, courseId: courseVersions.courseId, version: courseVersions.version, title: courseVersions.title, createdAt: courseVersions.createdAt, externalRef: courseVersions.externalRef, content: courseVersions.content })
              .from(courseVersions)
              .where(inArray(courseVersions.courseId, rows.map((row) => row.id)))
              .orderBy(desc(courseVersions.version))
              .all()
        : [];
    return {
        courses: rows.map((row) => ({
            id: row.id,
            key: row.key,
            title: row.title,
            archived: row.archivedAt !== null,
            versions: versions
                .filter((version) => version.courseId === row.id)
                .map((version) => {
                    const content = parseStoredContent(version.content);
                    return { id: version.id, version: version.version, title: version.title, createdAt: version.createdAt, externalRef: version.externalRef, lessons: content.lessons.length, questions: content.test.questions.length, passPercent: content.test.passPercent };
                }),
        })),
    };
}

export async function listAssignments(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const scope = await resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true });
    const rows = await ctx.db
        .select({
            id: courseAssignments.id,
            courseId: courseAssignments.courseId,
            courseTitle: courses.title,
            scope: courseAssignments.scope,
            branchId: courseAssignments.branchId,
            branchName: branches.name,
            userId: courseAssignments.userId,
            userName: users.displayName,
            userBranchId: users.branchId,
            createdAt: courseAssignments.createdAt,
        })
        .from(courseAssignments)
        .innerJoin(courses, eq(courses.id, courseAssignments.courseId))
        .leftJoin(branches, eq(branches.id, courseAssignments.branchId))
        .leftJoin(users, eq(users.id, courseAssignments.userId))
        .where(and(eq(courseAssignments.companyId, actor.companyId), isNull(courseAssignments.removedAt)))
        .orderBy(desc(courseAssignments.createdAt))
        .all();
    const visible = rows.filter((row) => {
        if (scope.kind === "all") return true;
        if (row.scope === "company") return true;
        if (row.scope === "branch") return row.branchId === scope.branchId;
        return row.userBranchId === scope.branchId;
    });
    return {
        assignments: visible.map(({ userBranchId: _userBranchId, ...row }) => ({
            ...row,
            canRemove: actor.role === "director" || (row.scope === "branch" && row.branchId === actor.branchId) || (row.scope === "user" && _userBranchId === actor.branchId),
        })),
    };
}

export async function createAssignment(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const body = await readJson(ctx.request);
    const courseId = str(body, "courseId", { max: 64 });
    const course = await ctx.db.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.companyId, actor.companyId))).get();
    if (!course) throw badRequest("training.courseNotFound", { courseId: "training.courseNotFound" });
    const scope = str(body, "scope", { max: 10 });
    let branchId: string | null = null;
    let userId: string | null = null;
    if (scope === "company") {
        requireRole(actor, "director");
    } else if (scope === "branch") {
        const requested = actor.role === "manager" ? actor.branchId : str(body, "branchId", { max: 64 });
        branchId = (await loadCompanyBranch(ctx, actor, requested ?? "")).id;
    } else if (scope === "user") {
        const target = await ctx.db.select().from(users).where(and(eq(users.id, str(body, "userId", { max: 64 })), eq(users.companyId, actor.companyId))).get();
        if (!target || (actor.role === "manager" && target.branchId !== actor.branchId)) throw new AppError(404, "team.userNotFound");
        userId = target.id;
    } else {
        throw badRequest("validation.invalidInput", { scope: "validation.invalidInput" });
    }
    const duplicate = await ctx.db
        .select({ id: courseAssignments.id })
        .from(courseAssignments)
        .where(
            and(
                eq(courseAssignments.courseId, course.id),
                eq(courseAssignments.scope, scope),
                isNull(courseAssignments.removedAt),
                branchId ? eq(courseAssignments.branchId, branchId) : isNull(courseAssignments.branchId),
                userId ? eq(courseAssignments.userId, userId) : isNull(courseAssignments.userId)
            )
        )
        .get();
    if (duplicate) return { id: duplicate.id, created: false };
    const id = newId();
    await ctx.db.insert(courseAssignments).values({ id, companyId: actor.companyId, courseId: course.id, scope, branchId, userId, createdBy: actor.userId, createdAt: ctx.now });
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "training.assign", entityType: "course", entityId: course.id, data: { scope, branchId, userId } }, ctx.now);
    return { id, created: true };
}

export async function removeAssignment(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const row = await ctx.db
        .select({ id: courseAssignments.id, scope: courseAssignments.scope, branchId: courseAssignments.branchId, userBranchId: users.branchId })
        .from(courseAssignments)
        .leftJoin(users, eq(users.id, courseAssignments.userId))
        .where(and(eq(courseAssignments.id, ctx.params["id"] ?? ""), eq(courseAssignments.companyId, actor.companyId), isNull(courseAssignments.removedAt)))
        .get();
    if (!row) throw new AppError(404, "error.notFound");
    const allowed = actor.role === "director" || (row.scope === "branch" && row.branchId === actor.branchId) || (row.scope === "user" && row.userBranchId === actor.branchId);
    if (!allowed) throw new AppError(403, "auth.forbidden");
    await ctx.db.update(courseAssignments).set({ removedAt: ctx.now }).where(eq(courseAssignments.id, row.id));
    return { ok: true };
}

// --- Правила допуска -----------------------------------------------------

export async function getAdmissionRules(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (!isStaff(actor)) throw new AppError(403, "auth.forbidden");
    const rules = await companyRules(ctx.db, actor.companyId);
    const visible = actor.role === "director" ? rules : rules.filter((rule) => rule.branchId === null || rule.branchId === actor.branchId);
    const courseRows = await ctx.db.select({ key: courses.key, title: courses.title }).from(courses).where(eq(courses.companyId, actor.companyId)).all();
    const titles = new Map(courseRows.map((row) => [row.key, row.title]));
    return {
        source: rules[0]?.source ?? "company",
        canEdit: actor.role === "director",
        rules: visible.map((rule) => ({ ...rule, role: "employee", courseTitle: titles.get(rule.courseKey) ?? null })),
    };
}

/** Директор задаёт полный набор правил: по ролям (сейчас — сотрудник) и филиалам */
export async function saveAdmissionRules(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const body = await readJson(ctx.request);
    const raw = body["rules"];
    if (!Array.isArray(raw) || raw.length > 50) throw badRequest("validation.invalidInput");
    const parsed: Array<{ branchId: string | null; courseKey: string; minScorePercent: number }> = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) throw badRequest("validation.invalidInput");
        const rule = item as Record<string, unknown>;
        const courseKey = typeof rule["courseKey"] === "string" ? rule["courseKey"].trim().toLowerCase() : "";
        const minScore = rule["minScorePercent"];
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(courseKey)) throw badRequest("training.ruleCourseInvalid");
        if (typeof minScore !== "number" || !Number.isInteger(minScore) || minScore < 1 || minScore > 100) throw badRequest("training.ruleScoreInvalid");
        let branchId: string | null = null;
        if (typeof rule["branchId"] === "string" && rule["branchId"]) branchId = (await loadCompanyBranch(ctx, actor, rule["branchId"])).id;
        if (parsed.some((existing) => existing.branchId === branchId && existing.courseKey === courseKey)) throw badRequest("training.ruleDuplicate");
        parsed.push({ branchId, courseKey, minScorePercent: minScore });
    }
    await ctx.db
        .update(admissionRules)
        .set({ removedAt: ctx.now })
        .where(and(eq(admissionRules.companyId, actor.companyId), isNull(admissionRules.removedAt)));
    for (const rule of parsed) {
        await ctx.db.insert(admissionRules).values({ id: newId(), companyId: actor.companyId, role: "employee", ...rule, createdBy: actor.userId, createdAt: ctx.now });
    }
    await markRulesCustomized(ctx.db, actor.companyId, actor.userId, ctx.now);
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "admission.rules", entityType: "company", entityId: actor.companyId, data: { rules: parsed } }, ctx.now);
    return { ok: true };
}
