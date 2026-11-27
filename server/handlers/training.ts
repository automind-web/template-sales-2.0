import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { admissionRules, admissions, branches, courseAssignments, courses, courseVersions, lessonProgress, testAttempts, trainingFiles, users } from "../../db/schema.ts";
import { resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, requireRole, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { isUniqueViolation, newId } from "../db.ts";
import { AppError, readJson, str } from "../http.ts";
import { sha256Hex } from "../crypto.ts";
import type { MessageKey } from "../../i18n/index.ts";
import {
    applyAdmissionRules,
    assignedCourseIds,
    companyRules,
    ensureProgram,
    evaluateRules,
    latestVersion,
    markRulesCustomized,
    parseStoredContent,
    programContent,
    PROGRAM_KEY,
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
    const [, rules] = await Promise.all([ensureProgram(ctx.db, actor.companyId, ctx.now), companyRules(ctx.db, actor.companyId)]);
    const assigned = await assignedCourseIds(ctx.db, user, rules);
    const ids = [...assigned.keys()];
    // Курсы, уроки, попытки, версии и правила допуска — одной волной параллельных запросов.
    const [courseRows, done, attempts, versionRows, evaluation] = await Promise.all([
        ids.length ? ctx.db.select().from(courses).where(inArray(courses.id, ids)).orderBy(courses.title).all() : Promise.resolve([]),
        completedLessons(ctx, actor.userId, ids),
        attemptSummaries(ctx, [actor.userId], ids),
        ids.length ? ctx.db.select().from(courseVersions).where(inArray(courseVersions.courseId, ids)).orderBy(desc(courseVersions.version)).all() : Promise.resolve([]),
        evaluateRules(ctx.db, user),
    ]);
    const latestByCourse = new Map<string, (typeof versionRows)[number]>();
    for (const row of versionRows) if (!latestByCourse.has(row.courseId)) latestByCourse.set(row.courseId, row);

    const items = [];
    for (const course of courseRows) {
        const version = latestByCourse.get(course.id);
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
    const [, scope] = await Promise.all([ensureProgram(ctx.db, actor.companyId, ctx.now), resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true })]);
    const conditions = [eq(users.companyId, actor.companyId), eq(users.role, "employee"), eq(users.status, "active")];
    if (scope.kind === "one") conditions.push(eq(users.branchId, scope.branchId));
    const people = await ctx.db
        .select({ id: users.id, displayName: users.displayName, login: users.login, branchId: users.branchId, branchName: branches.name })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.branchId))
        .where(and(...conditions))
        .orderBy(users.displayName)
        .all();
    if (!people.length) return { employees: [] };
    const userIds = people.map((person) => person.id);
    // Всё для всех сотрудников сразу: постоянное число обращений к базе, сколько бы людей ни было в команде.
    const [rules, admittedRows, companyCourses, assignments] = await Promise.all([
        companyRules(ctx.db, actor.companyId),
        ctx.db.select({ userId: admissions.userId }).from(admissions).where(and(inArray(admissions.userId, userIds), isNull(admissions.revokedAt))).all(),
        ctx.db.select({ id: courses.id, key: courses.key, archivedAt: courses.archivedAt }).from(courses).where(eq(courses.companyId, actor.companyId)).all(),
        ctx.db
            .select({ courseId: courseAssignments.courseId, scope: courseAssignments.scope, branchId: courseAssignments.branchId, userId: courseAssignments.userId })
            .from(courseAssignments)
            .where(and(eq(courseAssignments.companyId, actor.companyId), isNull(courseAssignments.removedAt)))
            .all(),
    ]);
    const admittedIds = new Set(admittedRows.map((row) => row.userId));
    const courseByKey = new Map(companyCourses.map((course) => [course.key, course]));
    const liveCourseIds = companyCourses.filter((course) => course.archivedAt === null).map((course) => course.id);
    const [versionRows, progressRows, attempts] = await Promise.all([
        liveCourseIds.length ? ctx.db.select().from(courseVersions).where(inArray(courseVersions.courseId, liveCourseIds)).orderBy(desc(courseVersions.version)).all() : Promise.resolve([]),
        liveCourseIds.length
            ? ctx.db.select({ userId: lessonProgress.userId, courseId: lessonProgress.courseId, lessonKey: lessonProgress.lessonKey }).from(lessonProgress).where(inArray(lessonProgress.userId, userIds)).all()
            : Promise.resolve([]),
        attemptSummaries(ctx, userIds, liveCourseIds),
    ]);
    // Последняя версия каждого курса (строки уже отсортированы по убыванию версии)
    const latest = new Map<string, { title: string; version: number; content: CourseContent }>();
    for (const row of versionRows) if (!latest.has(row.courseId)) latest.set(row.courseId, { title: row.title, version: row.version, content: parseStoredContent(row.content) });
    const done = new Map<string, Set<string>>();
    for (const row of progressRows) {
        const key = `${row.userId}:${row.courseId}`;
        if (!done.has(key)) done.set(key, new Set());
        done.get(key)!.add(row.lessonKey);
    }

    const rows = [];
    for (const person of people) {
        const applicable = rulesForBranch(rules, person.branchId);
        // Курсы человека: из правил допуска его филиала и явные назначения (как assignedCourseIds)
        const assigned = new Map<string, number | null>();
        for (const item of assignments) {
            if ((item.scope === "user" && item.userId === person.id) || item.scope === "company" || (item.scope === "branch" && item.branchId === person.branchId)) assigned.set(item.courseId, null);
        }
        for (const rule of applicable) {
            const course = courseByKey.get(rule.courseKey);
            if (course) assigned.set(course.id, rule.minScorePercent);
        }
        const own = attempts.filter((attempt) => attempt.userId === person.id);
        const bestFor = (courseId: string) =>
            own.filter((attempt) => attempt.courseId === courseId && attempt.status === "submitted").reduce<number | null>((max, attempt) => (attempt.scorePercent !== null && (max === null || attempt.scorePercent > max) ? attempt.scorePercent : max), null);
        const coursesInfo = [];
        for (const [courseId, requiredMin] of assigned) {
            const version = latest.get(courseId);
            if (!version) continue;
            const mine = own.filter((attempt) => attempt.courseId === courseId);
            const submitted = mine.filter((attempt) => attempt.status === "submitted");
            const best = bestFor(courseId);
            const last = submitted[0] ?? null;
            const minScore = requiredMin ?? version.content.test.passPercent;
            coursesInfo.push({
                courseId,
                title: version.title,
                lessons: progressFor(version.content, done.get(`${person.id}:${courseId}`) ?? new Set()),
                attempts: submitted.length,
                inProgress: mine.some((attempt) => attempt.status === "in_progress"),
                bestPercent: best,
                lastPercent: last?.scorePercent ?? null,
                lastSubmittedAt: last?.submittedAt ?? null,
                lastVersion: last?.version ?? null,
                minScorePercent: minScore,
                passed: best !== null && best >= minScore,
            });
        }
        const evaluation = applicable.map((rule) => {
            const course = courseByKey.get(rule.courseKey);
            const best = course ? bestFor(course.id) : null;
            return { courseKey: rule.courseKey, minScorePercent: rule.minScorePercent, bestPercent: best, satisfied: best !== null && best >= rule.minScorePercent, courseAvailable: Boolean(course) };
        });
        rows.push({ ...person, admitted: admittedIds.has(person.id), courses: coursesInfo, rules: evaluation });
    }
    return { employees: rows };
}

// --- Программа обучения (директор) ----------------------------------------

/** Программа в виде полей редактора: уроки и вопросы с вариантами (с правильными ответами) */
export async function getProgram(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const course = await ensureProgram(ctx.db, actor.companyId, ctx.now);
    const version = (await latestVersion(ctx.db, course.id))!;
    const content = parseStoredContent(version.content);
    return {
        title: version.title,
        description: version.description ?? "",
        version: version.version,
        updatedAt: version.createdAt,
        passPercent: content.test.passPercent,
        lessons: content.lessons.map((lesson) => ({ title: lesson.title, body: lesson.body, minutes: lesson.durationMinutes })),
        questions: content.test.questions.map((question) => ({
            text: question.text,
            options: question.options.map((option) => option.text),
            correct: question.correct.map((key) => question.options.findIndex((option) => option.key === key)).filter((index) => index >= 0),
        })),
    };
}

function programInput(body: Record<string, unknown>) {
    const invalid = (field: string, key: MessageKey = "training.programInvalid") => new AppError(400, key, { fields: { [field]: key } });
    const title = str(body, "title", { max: 120 });
    const description = typeof body["description"] === "string" ? body["description"].trim().slice(0, 500) : "";
    const passPercent = body["passPercent"];
    if (typeof passPercent !== "number" || !Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) throw invalid("passPercent", "training.ruleScoreInvalid");
    const lessonsRaw = Array.isArray(body["lessons"]) ? body["lessons"] : [];
    const questionsRaw = Array.isArray(body["questions"]) ? body["questions"] : [];
    if (lessonsRaw.length < 1 || lessonsRaw.length > 50) throw invalid("lessons", "training.programNeedsLesson");
    if (questionsRaw.length < 1 || questionsRaw.length > 100) throw invalid("questions", "training.programNeedsQuestion");
    const lessons = lessonsRaw.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const lessonTitle = typeof item["title"] === "string" ? item["title"].trim() : "";
        const lessonBody = typeof item["body"] === "string" ? item["body"].trim() : "";
        if (!lessonTitle || lessonTitle.length > 200 || lessonBody.length > 50_000) throw invalid(`lessons.${index}`);
        const minutes = typeof item["minutes"] === "number" && Number.isInteger(item["minutes"]) && item["minutes"] > 0 && item["minutes"] <= 600 ? item["minutes"] : null;
        return { title: lessonTitle, body: lessonBody, minutes };
    });
    const questions = questionsRaw.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const text = typeof item["text"] === "string" ? item["text"].trim() : "";
        const options = (Array.isArray(item["options"]) ? item["options"] : []).map((option) => (typeof option === "string" ? option.trim() : "")).filter(Boolean);
        const correct = [...new Set((Array.isArray(item["correct"]) ? item["correct"] : []).filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < options.length))];
        if (!text || text.length > 2_000 || options.length < 2 || options.length > 10 || options.some((option) => option.length > 2_000)) throw invalid(`questions.${index}`);
        if (!correct.length) throw invalid(`questions.${index}`, "training.programNeedsCorrect");
        return { text, options, correct };
    });
    return { title, description, passPercent, lessons, questions };
}

/**
 * Сохранение программы: новая неизменяемая редакция. Начатые тесты завершаются
 * по своей редакции, новая применяется со следующей попытки.
 */
export async function saveProgram(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const input = programInput(await readJson(ctx.request));
    const course = await ensureProgram(ctx.db, actor.companyId, ctx.now);
    const serialized = JSON.stringify(programContent(input));
    const checksum = await sha256Hex(`${input.title}\n${input.description}\n${serialized}`);
    const latest = await latestVersion(ctx.db, course.id);
    if (!latest || latest.checksum !== checksum) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await ctx.env.DB.prepare(
                    `INSERT INTO course_versions (id, company_id, course_id, version, title, description, content, checksum, external_ref, source, created_at)
                     SELECT ?1, ?2, ?3, COALESCE(MAX(version), 0) + 1, ?4, ?5, ?6, ?7, NULL, 'site', ?8 FROM course_versions WHERE course_id = ?3`
                )
                    .bind(newId(), actor.companyId, course.id, input.title, input.description || null, serialized, checksum, ctx.now)
                    .run();
                break;
            } catch (error) {
                if (!isUniqueViolation(error) || attempt === 2) throw error;
            }
        }
        await ctx.db.update(courses).set({ title: input.title }).where(eq(courses.id, course.id));
    }
    // Проходной балл программы — он же условие доступа к рабочему месту.
    await ctx.db.update(admissionRules).set({ removedAt: ctx.now }).where(and(eq(admissionRules.companyId, actor.companyId), isNull(admissionRules.removedAt)));
    await ctx.db.insert(admissionRules).values({ id: newId(), companyId: actor.companyId, role: "employee", branchId: null, courseKey: PROGRAM_KEY, minScorePercent: input.passPercent, createdBy: actor.userId, createdAt: ctx.now });
    await markRulesCustomized(ctx.db, actor.companyId, actor.userId, ctx.now);
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "training.program", entityType: "course", entityId: course.id }, ctx.now);
    return getProgram(ctx);
}
