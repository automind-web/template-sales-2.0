/**
 * Обучение: содержимое редакций, подсчёт результата теста, назначенные курсы
 * и применение правил допуска. Используется обработчиками API и интеграцией.
 */
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { companyConfig } from "../config/company.ts";
import { admissionRules, admissions, companySettings, courseAssignments, courses, courseVersions, testAttempts, users } from "../db/schema.ts";
import { newId, type Db } from "./db.ts";
import { AppError } from "./http.ts";

// --- Содержимое редакции -------------------------------------------------

export type Lesson = { key: string; title: string; body: string; fileIds: string[]; durationMinutes: number | null };
export type Question = { key: string; text: string; kind: "single" | "multiple"; options: Array<{ key: string; text: string }>; correct: string[] };
export type CourseContent = { lessons: Lesson[]; test: { passPercent: number; questions: Question[] } };

export const CONTENT_LIMITS = {
    lessons: 200,
    lessonBody: 50_000,
    questions: 200,
    options: 10,
    text: 2_000,
    key: 64,
};

const KEY_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export class ContentError extends Error {}

function requireString(value: unknown, path: string, max: number, { allowEmpty = false } = {}): string {
    if (typeof value !== "string") throw new ContentError(`${path}: ожидается строка`);
    const trimmed = value.trim();
    if (!allowEmpty && trimmed.length === 0) throw new ContentError(`${path}: пустое значение`);
    if (trimmed.length > max) throw new ContentError(`${path}: длиннее ${max} символов`);
    return trimmed;
}

function requireKey(value: unknown, path: string): string {
    const key = requireString(value, path, CONTENT_LIMITS.key);
    if (!KEY_PATTERN.test(key)) throw new ContentError(`${path}: допустимы латиница, цифры, точка, дефис, подчёркивание`);
    return key;
}

function requireArray(value: unknown, path: string, min: number, max: number): unknown[] {
    if (!Array.isArray(value)) throw new ContentError(`${path}: ожидается массив`);
    if (value.length < min || value.length > max) throw new ContentError(`${path}: от ${min} до ${max} элементов`);
    return value;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContentError(`${path}: ожидается объект`);
    return value as Record<string, unknown>;
}

/** Строгая проверка редакции, пришедшей из интеграции */
export function parseCourseContent(input: Record<string, unknown>): CourseContent {
    const lessonKeys = new Set<string>();
    const lessons = requireArray(input["lessons"], "lessons", 1, CONTENT_LIMITS.lessons).map((raw, index) => {
        const lesson = asRecord(raw, `lessons[${index}]`);
        const key = requireKey(lesson["key"], `lessons[${index}].key`);
        if (lessonKeys.has(key)) throw new ContentError(`lessons[${index}].key: повторяется «${key}»`);
        lessonKeys.add(key);
        const fileIds = lesson["fileIds"] === undefined ? [] : requireArray(lesson["fileIds"], `lessons[${index}].fileIds`, 0, 20).map((id, i) => requireString(id, `lessons[${index}].fileIds[${i}]`, 64));
        const duration = lesson["durationMinutes"];
        if (duration !== undefined && duration !== null && (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 600)) {
            throw new ContentError(`lessons[${index}].durationMinutes: целое от 1 до 600`);
        }
        return {
            key,
            title: requireString(lesson["title"], `lessons[${index}].title`, 200),
            body: requireString(lesson["body"], `lessons[${index}].body`, CONTENT_LIMITS.lessonBody, { allowEmpty: true }),
            fileIds,
            durationMinutes: typeof duration === "number" ? duration : null,
        };
    });

    const test = asRecord(input["test"], "test");
    const passPercentRaw = test["passPercent"] ?? companyConfig.admissionRules[0]?.minScorePercent ?? 80;
    if (typeof passPercentRaw !== "number" || !Number.isInteger(passPercentRaw) || passPercentRaw < 1 || passPercentRaw > 100) {
        throw new ContentError("test.passPercent: целое от 1 до 100");
    }
    const questionKeys = new Set<string>();
    const questions = requireArray(test["questions"], "test.questions", 1, CONTENT_LIMITS.questions).map((raw, index) => {
        const path = `test.questions[${index}]`;
        const question = asRecord(raw, path);
        const key = requireKey(question["key"], `${path}.key`);
        if (questionKeys.has(key)) throw new ContentError(`${path}.key: повторяется «${key}»`);
        questionKeys.add(key);
        const kind = question["kind"] ?? "single";
        if (kind !== "single" && kind !== "multiple") throw new ContentError(`${path}.kind: single или multiple`);
        const optionKeys = new Set<string>();
        const options = requireArray(question["options"], `${path}.options`, 2, CONTENT_LIMITS.options).map((rawOption, i) => {
            const option = asRecord(rawOption, `${path}.options[${i}]`);
            const optionKey = requireKey(option["key"], `${path}.options[${i}].key`);
            if (optionKeys.has(optionKey)) throw new ContentError(`${path}.options[${i}].key: повторяется`);
            optionKeys.add(optionKey);
            return { key: optionKey, text: requireString(option["text"], `${path}.options[${i}].text`, CONTENT_LIMITS.text) };
        });
        const correct = requireArray(question["correct"], `${path}.correct`, 1, CONTENT_LIMITS.options).map((value, i) => requireKey(value, `${path}.correct[${i}]`));
        for (const value of correct) if (!optionKeys.has(value)) throw new ContentError(`${path}.correct: нет варианта «${value}»`);
        if (kind === "single" && correct.length !== 1) throw new ContentError(`${path}.correct: для single нужен ровно один ответ`);
        return { key, text: requireString(question["text"], `${path}.text`, CONTENT_LIMITS.text), kind, options, correct: [...new Set(correct)] } as Question;
    });
    return { lessons, test: { passPercent: passPercentRaw, questions } };
}

/** Вопросы для сотрудника — без правильных ответов */
export function publicQuestions(content: CourseContent) {
    return content.test.questions.map((question) => ({ key: question.key, text: question.text, kind: question.kind, options: question.options }));
}

export type Answers = Record<string, string[]>;

export function sanitizeAnswers(content: CourseContent, raw: unknown): Answers {
    const result: Answers = {};
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;
    for (const question of content.test.questions) {
        const value = (raw as Record<string, unknown>)[question.key];
        const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
        const allowed = new Set(question.options.map((option) => option.key));
        const picked = [...new Set(list.filter((item): item is string => typeof item === "string" && allowed.has(item)))];
        if (picked.length) result[question.key] = question.kind === "single" ? picked.slice(0, 1) : picked;
    }
    return result;
}

/** Вопрос засчитывается, если выбранный набор вариантов точно совпадает с правильным */
export function scoreAnswers(content: CourseContent, answers: Answers) {
    let correct = 0;
    for (const question of content.test.questions) {
        const picked = new Set(answers[question.key] ?? []);
        const expected = new Set(question.correct);
        if (picked.size === expected.size && [...expected].every((key) => picked.has(key))) correct += 1;
    }
    const total = content.test.questions.length;
    // Округление вниз: 79,9% не превращается в 80%.
    const percent = total === 0 ? 0 : Math.floor((correct * 100) / total);
    return { correct, total, percent };
}

export function parseStoredContent(json: string): CourseContent {
    return JSON.parse(json) as CourseContent;
}

// --- Правила допуска -----------------------------------------------------

export type EffectiveRule = { courseKey: string; minScorePercent: number; branchId: string | null; source: "config" | "company" };

const RULES_CUSTOMIZED_KEY = "admissionRules.customized";

export async function rulesCustomized(db: Db, companyId: string): Promise<boolean> {
    const row = await db
        .select({ value: companySettings.value })
        .from(companySettings)
        .where(and(eq(companySettings.companyId, companyId), eq(companySettings.key, RULES_CUSTOMIZED_KEY)))
        .get();
    return row?.value === "1";
}

export async function markRulesCustomized(db: Db, companyId: string, userId: string, now: number) {
    await db
        .insert(companySettings)
        .values({ companyId, key: RULES_CUSTOMIZED_KEY, value: "1", updatedAt: now, updatedBy: userId })
        .onConflictDoUpdate({ target: [companySettings.companyId, companySettings.key], set: { value: "1", updatedAt: now, updatedBy: userId } });
}

/** Все действующие правила компании (из БД или, пока их не задали, из конфигурации) */
export async function companyRules(db: Db, companyId: string): Promise<EffectiveRule[]> {
    if (!(await rulesCustomized(db, companyId))) {
        return companyConfig.admissionRules
            .filter((rule) => rule.role === "employee")
            .map((rule) => ({ courseKey: rule.testKey, minScorePercent: rule.minScorePercent, branchId: rule.branchId, source: "config" as const }));
    }
    const rows = await db
        .select()
        .from(admissionRules)
        .where(and(eq(admissionRules.companyId, companyId), isNull(admissionRules.removedAt)))
        .all();
    return rows.map((row) => ({ courseKey: row.courseKey, minScorePercent: row.minScorePercent, branchId: row.branchId, source: "company" as const }));
}

/** Правила для сотрудника: правила его филиала, а если их нет — общие */
export function rulesForBranch(rules: EffectiveRule[], branchId: string | null): EffectiveRule[] {
    const own = rules.filter((rule) => rule.branchId !== null && rule.branchId === branchId);
    return own.length ? own : rules.filter((rule) => rule.branchId === null);
}

// --- Назначенные курсы ---------------------------------------------------

export type UserRef = { id: string; companyId: string; role: string; branchId: string | null };

/**
 * Курсы, назначенные человеку: явные назначения (компания / филиал / лично)
 * плюс курсы из правил допуска его филиала. Только курсы, у которых есть редакция.
 */
export async function assignedCourseIds(db: Db, user: UserRef, rules?: EffectiveRule[]): Promise<Map<string, { requiredMin: number | null }>> {
    const result = new Map<string, { requiredMin: number | null }>();
    // Назначения на компанию и филиал адресованы сотрудникам; личное — любому.
    const scopes = [and(eq(courseAssignments.scope, "user"), eq(courseAssignments.userId, user.id))];
    if (user.role === "employee") {
        scopes.push(eq(courseAssignments.scope, "company"));
        if (user.branchId) scopes.push(and(eq(courseAssignments.scope, "branch"), eq(courseAssignments.branchId, user.branchId)));
    }
    const explicit = await db
        .select({ courseId: courseAssignments.courseId })
        .from(courseAssignments)
        .where(and(eq(courseAssignments.companyId, user.companyId), isNull(courseAssignments.removedAt), or(...scopes)))
        .all();
    for (const row of explicit) result.set(row.courseId, { requiredMin: null });

    if (user.role === "employee") {
        const applicable = rulesForBranch(rules ?? (await companyRules(db, user.companyId)), user.branchId);
        if (applicable.length) {
            const ruleCourses = await db
                .select({ id: courses.id, key: courses.key })
                .from(courses)
                .where(and(eq(courses.companyId, user.companyId), inArray(courses.key, applicable.map((rule) => rule.courseKey))))
                .all();
            for (const course of ruleCourses) {
                const rule = applicable.find((item) => item.courseKey === course.key);
                result.set(course.id, { requiredMin: rule?.minScorePercent ?? null });
            }
        }
    }
    if (result.size === 0) return result;
    const live = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(inArray(courses.id, [...result.keys()]), isNull(courses.archivedAt)))
        .all();
    const liveIds = new Set(live.map((row) => row.id));
    for (const id of [...result.keys()]) if (!liveIds.has(id)) result.delete(id);
    if (result.size === 0) return result;
    const versioned = await db
        .selectDistinct({ courseId: courseVersions.courseId })
        .from(courseVersions)
        .where(inArray(courseVersions.courseId, [...result.keys()]))
        .all();
    const versionedIds = new Set(versioned.map((row) => row.courseId));
    for (const id of [...result.keys()]) if (!versionedIds.has(id)) result.delete(id);
    return result;
}

export async function latestVersion(db: Db, courseId: string) {
    return db.select().from(courseVersions).where(eq(courseVersions.courseId, courseId)).orderBy(desc(courseVersions.version)).limit(1).get();
}

// --- Применение правил допуска -------------------------------------------

export type AdmissionOutcome = {
    admitted: boolean;
    granted: boolean;
    rules: Array<{ courseKey: string; minScorePercent: number; bestPercent: number | null; satisfied: boolean; courseAvailable: boolean }>;
};

/**
 * Проверяет правила допуска сотрудника и выдаёт допуск, если все выполнены.
 * Допуск не снимается автоматически при смене правил — только вручную или при переводе.
 */
export async function applyAdmissionRules(db: Db, userId: string, now: number, attemptId: string | null): Promise<AdmissionOutcome> {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new AppError(404, "team.userNotFound");
    const active = await db.select({ id: admissions.id }).from(admissions).where(and(eq(admissions.userId, userId), isNull(admissions.revokedAt))).get();
    const evaluation = await evaluateRules(db, user);
    if (user.role !== "employee") return { admitted: true, granted: false, rules: evaluation };
    const allSatisfied = evaluation.length > 0 && evaluation.every((rule) => rule.satisfied);
    if (active) return { admitted: true, granted: false, rules: evaluation };
    if (!allSatisfied) return { admitted: false, granted: false, rules: evaluation };
    await db.insert(admissions).values({
        id: newId(),
        companyId: user.companyId,
        userId,
        source: "test",
        sourceRef: attemptId,
        grantedBy: null,
        grantedAt: now,
        reason: null,
    });
    return { admitted: true, granted: true, rules: evaluation };
}

export async function evaluateRules(db: Db, user: UserRef) {
    if (user.role !== "employee") return [];
    const applicable = rulesForBranch(await companyRules(db, user.companyId), user.branchId);
    const result: AdmissionOutcome["rules"] = [];
    for (const rule of applicable) {
        const course = await db
            .select({ id: courses.id })
            .from(courses)
            .where(and(eq(courses.companyId, user.companyId), eq(courses.key, rule.courseKey)))
            .get();
        let best: number | null = null;
        if (course) {
            const attempts = await db
                .select({ percent: testAttempts.scorePercent })
                .from(testAttempts)
                .where(and(eq(testAttempts.userId, user.id), eq(testAttempts.courseId, course.id), eq(testAttempts.status, "submitted")))
                .all();
            for (const attempt of attempts) if (attempt.percent !== null && (best === null || attempt.percent > best)) best = attempt.percent;
        }
        result.push({
            courseKey: rule.courseKey,
            minScorePercent: rule.minScorePercent,
            bestPercent: best,
            satisfied: best !== null && best >= rule.minScorePercent,
            courseAvailable: Boolean(course),
        });
    }
    return result;
}

// --- Единая программа обучения ------------------------------------------

export const PROGRAM_KEY = companyConfig.training.key;

/** Программа из простых полей редактора (или из config) → содержимое редакции */
export function programContent(input: { passPercent: number; lessons: Array<{ title: string; body: string; minutes?: number | null }>; questions: Array<{ text: string; options: string[]; correct: number[] }> }): CourseContent {
    return {
        lessons: input.lessons.map((lesson, index) => ({ key: `l${index + 1}`, title: lesson.title, body: lesson.body, fileIds: [], durationMinutes: lesson.minutes ?? null })),
        test: {
            passPercent: input.passPercent,
            questions: input.questions.map((question, index) => ({
                key: `q${index + 1}`,
                text: question.text,
                kind: question.correct.length > 1 ? "multiple" : "single",
                options: question.options.map((option, optionIndex) => ({ key: String.fromCharCode(97 + optionIndex), text: option })),
                correct: question.correct.map((optionIndex) => String.fromCharCode(97 + optionIndex)),
            })),
        },
    };
}

/** Курс программы; при первом обращении создаётся из стартовой программы config/company.ts */
export async function ensureProgram(db: Db, companyId: string, now: number) {
    let course = await db.select().from(courses).where(and(eq(courses.companyId, companyId), eq(courses.key, PROGRAM_KEY))).get();
    if (course && (await latestVersion(db, course.id))) return course;
    if (!course) {
        await db.insert(courses).values({ id: newId(), companyId, key: PROGRAM_KEY, title: companyConfig.training.title, createdAt: now }).onConflictDoNothing();
        course = await db.select().from(courses).where(and(eq(courses.companyId, companyId), eq(courses.key, PROGRAM_KEY))).get();
        if (!course) throw new AppError(500, "error.internal");
    }
    const content = programContent(companyConfig.training);
    await db
        .insert(courseVersions)
        .values({ id: newId(), companyId, courseId: course.id, version: 1, title: companyConfig.training.title, description: companyConfig.training.description, content: JSON.stringify(content), checksum: "starter", externalRef: null, source: "site", createdAt: now })
        .onConflictDoNothing();
    return course;
}
