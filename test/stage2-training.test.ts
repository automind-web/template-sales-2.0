import assert from "node:assert/strict";
import test from "node:test";
import { parseCourseContent, scoreAnswers } from "../server/training.ts";
import { bootstrapDirector, createTestEnv, integration, invite, TestClient } from "./support/client.ts";

type Course = {
    id: string;
    key: string;
    version: number;
    lessons: { total: number; completed: number; percent: number };
    requiredForAdmission: boolean;
    minScorePercent: number;
    bestPercent: number | null;
    passed: boolean;
    openAttempt: { id: string; version: number } | null;
};
type MyCourses = { courses: Course[]; admission: { admitted: boolean; missingCourses: string[]; rules: Array<{ courseKey: string; satisfied: boolean }> } };
type Attempt = { attempt: { id: string; version: number; latestVersion: number; status: string; questions: Array<{ key: string; options: Array<{ key: string }>; correct?: unknown }>; answers: Record<string, string[]>; result: { percent: number; passed: boolean; correct: number; total: number } | null } };
type Submit = Attempt & { repeated: boolean; admission: { admitted: boolean; granted: boolean } };

/** Редакция курса: 5 вопросов, правильный ответ — вариант a (в v2 — вариант b) */
function edition(version: 1 | 2, extra: Record<string, unknown> = {}) {
    const right = version === 1 ? "a" : "b";
    return {
        approved: true,
        title: `Основы продаж v${version}`,
        externalRef: `rev-${version}`,
        lessons: [
            { key: "intro", title: "Введение", body: "Кто наш клиент.\n\n- первый пункт\n- второй пункт" },
            { key: "calls", title: "Звонки", body: "Как звонить.", durationMinutes: 15 },
        ],
        test: {
            passPercent: 80,
            questions: [1, 2, 3, 4, 5].map((n) => ({
                key: `q${n}`,
                text: `Вопрос ${n} (ред. ${version})`,
                kind: n === 5 ? "multiple" : "single",
                options: [
                    { key: "a", text: "A" },
                    { key: "b", text: "B" },
                    { key: "c", text: "C" },
                ],
                correct: n === 5 ? [right, "c"] : [right],
            })),
        },
        ...extra,
    };
}

function answersFor(version: 1 | 2, correctCount: number) {
    const right = version === 1 ? "a" : "b";
    const wrong = version === 1 ? "b" : "a";
    const result: Record<string, string[]> = {};
    for (let n = 1; n <= 5; n += 1) {
        const ok = n <= correctCount;
        result[`q${n}`] = n === 5 ? (ok ? [right, "c"] : [right]) : [ok ? right : wrong];
    }
    return result;
}

async function setup() {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);
    const north = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север" })).body.branch.id;
    const south = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг" })).body.branch.id;
    const manager = await invite(env, director, { role: "manager", branchId: north }, "north.manager");
    const employee = await invite(env, manager, { role: "employee" }, "north.employee");
    const southEmployee = await invite(env, director, { role: "employee", branchId: south }, "south.employee");
    return { env, director, manager, employee, southEmployee, north, south };
}

test("интеграция: токен, утверждённость, проверка содержимого, версии и идемпотентность", async () => {
    const { env } = await setup();
    assert.equal((await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1), null)).status, 401);
    assert.equal((await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1), "wrong")).status, 401);
    const noSecret = createTestEnv({ INTEGRATION_TOKEN: "" });
    assert.equal((await integration(noSecret, "POST", "/api/integration/training/courses/x/versions", edition(1))).status, 503);

    const draft = await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1, { approved: false }));
    assert.equal(draft.status, 400, "неутверждённая редакция не принимается");
    const broken = await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1, { test: { questions: [{ key: "q", text: "?", options: [{ key: "a", text: "A" }, { key: "b", text: "B" }], correct: ["z"] }] } }));
    assert.equal(broken.status, 400);
    assert.match(broken.body.error!.message, /нет варианта «z»/);

    const v1 = await integration<{ created: boolean; version: number }>(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1));
    assert.equal(v1.status, 200);
    assert.deepEqual([v1.body.created, v1.body.version], [true, 1]);
    const repeat = await integration<{ created: boolean; version: number }>(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1));
    assert.deepEqual([repeat.body.created, repeat.body.version], [false, 1], "повтор доставки не создаёт новую версию");
    const tampered = await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", { ...edition(1), title: "Изменённая" });
    assert.equal(tampered.status, 409, "утверждённая версия не изменяется");
    const v2 = await integration<{ created: boolean; version: number }>(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(2));
    assert.deepEqual([v2.body.created, v2.body.version], [true, 2]);

    const list = await integration<{ courses: Array<{ key: string; versions: Array<{ version: number }> }> }>(env, "GET", "/api/integration/training/courses");
    assert.deepEqual(list.body.courses[0]!.versions.map((version) => version.version), [1, 2]);
    const versions = env.DB.sqlite.prepare("SELECT version, title FROM course_versions ORDER BY version").all() as Array<{ version: number; title: string }>;
    assert.equal(versions[0]!.title, "Основы продаж v1", "старая версия хранится без изменений");
});

test("чистый старт: правило допуска ссылается на ещё не загруженный курс", async () => {
    const { employee, director } = await setup();
    const mine = await employee.get<MyCourses>("/api/training/courses");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.courses.length, 0);
    assert.deepEqual(mine.body.admission.missingCourses, ["sales-basics"]);
    const rules = await director.get<{ source: string; rules: Array<{ courseKey: string; courseTitle: string | null }> }>("/api/training/admission-rules");
    assert.equal(rules.body.source, "config");
    assert.equal(rules.body.rules[0]!.courseTitle, null);
});

test("тест завершается по своей версии, новая редакция — со следующей попытки; допуск выдаётся автоматически", async () => {
    const { env, employee } = await setup();
    await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1));

    let mine = await employee.get<MyCourses>("/api/training/courses");
    assert.equal(mine.body.courses.length, 1, "курс из правила допуска назначен автоматически");
    const course = mine.body.courses[0]!;
    assert.equal(course.requiredForAdmission, true);
    assert.equal(course.minScorePercent, 80);

    assert.equal((await employee.post(`/api/training/courses/${course.id}/lessons/intro/complete`)).status, 200);
    assert.equal((await employee.post(`/api/training/courses/${course.id}/lessons/intro/complete`)).status, 200, "повторная отметка безопасна");
    assert.equal((await employee.post(`/api/training/courses/${course.id}/lessons/nope/complete`)).status, 404);
    mine = await employee.get<MyCourses>("/api/training/courses");
    assert.deepEqual(mine.body.courses[0]!.lessons, { total: 2, completed: 1, percent: 50 });

    // Двойное нажатие «Начать тест» даёт одну попытку
    const [first, second] = await Promise.all([
        employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`),
        employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`),
    ]);
    assert.equal(first.body.attempt.id, second.body.attempt.id);
    const attemptId = first.body.attempt.id;
    assert.equal(first.body.attempt.version, 1);
    assert.ok(first.body.attempt.questions.every((question) => question.correct === undefined), "правильные ответы не уходят клиенту");

    // Автосохранение ответов
    await employee.put(`/api/training/attempts/${attemptId}/answers`, { answers: { q1: ["a"], q2: ["zzz"] } });
    // Во время теста выходит новая редакция
    await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(2));
    const resumed = await employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`);
    assert.equal(resumed.body.attempt.id, attemptId, "продолжается та же попытка");
    assert.equal(resumed.body.attempt.version, 1, "начатый тест — по своей версии");
    assert.equal(resumed.body.attempt.latestVersion, 2);
    assert.deepEqual(resumed.body.attempt.answers, { q1: ["a"] }, "сохранены только допустимые ответы");

    assert.equal((await employee.get("/api/sections/crm")).status, 403);
    // Ответы версии 1 (в версии 2 правильный вариант другой)
    const submitted = await employee.post<Submit>(`/api/training/attempts/${attemptId}/submit`, { answers: answersFor(1, 4) });
    assert.equal(submitted.status, 200);
    assert.deepEqual([submitted.body.attempt.result!.correct, submitted.body.attempt.result!.percent, submitted.body.attempt.result!.passed], [4, 80, true]);
    assert.equal(submitted.body.admission.granted, true);
    assert.equal((await employee.get("/api/sections/crm")).status, 200, "допуск действует со следующего запроса");

    const again = await employee.post<Submit>(`/api/training/attempts/${attemptId}/submit`, { answers: answersFor(1, 0) });
    assert.equal(again.body.repeated, true, "повторная отправка не пересчитывает результат");
    assert.equal(again.body.attempt.result!.percent, 80);
    const count = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM admissions WHERE revoked_at IS NULL").get() as { n: number };
    assert.equal(count.n, 1, "допуск выдан один раз");

    const next = await employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`);
    assert.notEqual(next.body.attempt.id, attemptId);
    assert.equal(next.body.attempt.version, 2, "следующая попытка — по новой редакции");
    const v2Result = await employee.post<Submit>(`/api/training/attempts/${next.body.attempt.id}/submit`, { answers: answersFor(2, 5) });
    assert.equal(v2Result.body.attempt.result!.percent, 100);
});

test("недостаточный результат не даёт допуска; округление вниз", async () => {
    const { env, employee, director } = await setup();
    await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1));
    const course = (await employee.get<MyCourses>("/api/training/courses")).body.courses[0]!;
    const attempt = await employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`);
    const result = await employee.post<Submit>(`/api/training/attempts/${attempt.body.attempt.id}/submit`, { answers: answersFor(1, 3) });
    assert.deepEqual([result.body.attempt.result!.percent, result.body.attempt.result!.passed, result.body.admission.admitted], [60, false, false]);
    assert.equal((await employee.get("/api/sections/crm")).status, 403);

    // Порог берётся из правил компании, а не из редакции курса.
    await director.put("/api/training/admission-rules", { rules: [{ courseKey: "sales-basics", minScorePercent: 61 }] });
    const retry = await employee.post<Attempt>(`/api/training/courses/${course.id}/attempts`);
    const second = await employee.post<Submit>(`/api/training/attempts/${retry.body.attempt.id}/submit`, { answers: answersFor(1, 3) });
    assert.equal(second.body.attempt.result!.passed, false, "60% < 61%");
});

test("правила допуска по филиалам; права на правила, назначения и прогресс", async () => {
    const { env, director, manager, employee, southEmployee, south } = await setup();
    await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1));
    await integration(env, "POST", "/api/integration/training/courses/south-course/versions", { ...edition(1), externalRef: "south-1", title: "Курс Юга" });

    assert.equal((await manager.put("/api/training/admission-rules", { rules: [] })).status, 403);
    assert.equal((await director.put("/api/training/admission-rules", { rules: [{ courseKey: "sales-basics", minScorePercent: 0 }] })).status, 400);
    assert.equal(
        (
            await director.put("/api/training/admission-rules", {
                rules: [
                    { courseKey: "sales-basics", minScorePercent: 80 },
                    { courseKey: "south-course", minScorePercent: 100, branchId: south },
                ],
            })
        ).status,
        200
    );
    const northCourses = await employee.get<MyCourses>("/api/training/courses");
    assert.deepEqual(northCourses.body.courses.map((course) => course.key), ["sales-basics"]);
    const southCourses = await southEmployee.get<MyCourses>("/api/training/courses");
    assert.deepEqual(southCourses.body.courses.map((course) => course.key), ["south-course"], "правило филиала заменяет общее");
    assert.equal(southCourses.body.courses[0]!.minScorePercent, 100);

    // Курс Юга не назначен сотруднику Севера: по прямой ссылке — «не найдено»
    const southCourseId = southCourses.body.courses[0]!.id;
    assert.equal((await employee.get(`/api/training/courses/${southCourseId}`)).status, 404);
    assert.equal((await employee.post(`/api/training/courses/${southCourseId}/attempts`)).status, 404);

    // Назначения: руководитель — только свой филиал
    assert.equal((await manager.post("/api/training/assignments", { courseId: southCourseId, scope: "company" })).status, 403);
    const southUserId = (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = 'south.employee'").get() as { id: string }).id;
    assert.equal((await manager.post("/api/training/assignments", { courseId: southCourseId, scope: "user", userId: southUserId })).status, 404);
    const assigned = await manager.post<{ id: string; created: boolean }>("/api/training/assignments", { courseId: southCourseId, scope: "branch" });
    assert.equal(assigned.body.created, true);
    assert.equal((await manager.post<{ created: boolean }>("/api/training/assignments", { courseId: southCourseId, scope: "branch" })).body.created, false);
    const withAssigned = await employee.get<MyCourses>("/api/training/courses");
    assert.deepEqual(withAssigned.body.courses.map((course) => course.key).sort(), ["sales-basics", "south-course"]);
    assert.equal(withAssigned.body.courses.find((course) => course.key === "south-course")!.requiredForAdmission, false);

    // Прогресс: руководитель видит только свой филиал
    const progress = await manager.get<{ employees: Array<{ login: string; courses: unknown[]; admitted: boolean }> }>("/api/training/progress");
    assert.deepEqual(progress.body.employees.map((person) => person.login), ["north.employee"]);
    assert.equal((await manager.get(`/api/training/progress?branchId=${south}`)).status, 403);
    const all = await director.get<{ employees: Array<{ login: string }> }>("/api/training/progress?branchId=*");
    assert.deepEqual(all.body.employees.map((person) => person.login).sort(), ["north.employee", "south.employee"]);

    // Сотруднику закрыты управленческие разделы
    for (const path of ["/api/training/progress", "/api/training/catalog", "/api/training/assignments", "/api/training/admission-rules"]) {
        assert.equal((await employee.get(path)).status, 403, path);
    }
    assert.equal((await manager.delete(`/api/training/assignments/${assigned.body.id}`)).status, 200);
});

test("файлы материалов: R2 + метаданные в D1, доступ только к своим курсам", async () => {
    const { env, employee, southEmployee } = await setup();
    const form = new FormData();
    form.set("courseKey", "sales-basics");
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff])], "памятка.pdf", { type: "application/pdf" }));
    const uploaded = await integration<{ fileId: string; size: number }>(env, "POST", "/api/integration/training/files", form);
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.body.size, 5);
    assert.equal(env.BUCKET.objects.size, 1);

    const missing = await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1, { lessons: [{ key: "l", title: "Урок", body: "", fileIds: ["unknown"] }] }));
    assert.equal(missing.status, 400);
    const ok = await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", edition(1, { lessons: [{ key: "l", title: "Урок", body: "", fileIds: [uploaded.body.fileId] }] }));
    assert.equal(ok.status, 200);

    const course = (await employee.get<MyCourses>("/api/training/courses")).body.courses[0]!;
    const detail = await employee.get<{ course: { lessons: Array<{ files: Array<{ id: string; filename: string }> }> } }>(`/api/training/courses/${course.id}`);
    assert.equal(detail.body.course.lessons[0]!.files[0]!.filename, "памятка.pdf");

    const download = await employee.raw(`/api/training/files/${uploaded.body.fileId}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.match(download.headers.get("cache-control") ?? "", /private/);
    assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [0x25, 0x50, 0x44, 0x46, 0xff]);

    // Курс назначен правилом общим для всех филиалов, поэтому сотрудник Юга его видит;
    // а после отдельного правила филиала Юга — уже нет.
    const southId = (env.DB.sqlite.prepare("SELECT id FROM branches WHERE name = 'Юг'").get() as { id: string }).id;
    const director = new TestClient(env, "10.0.0.2");
    await director.post("/api/auth/login", { login: "director", password: "director-password-1" });
    await director.put("/api/training/admission-rules", { rules: [{ courseKey: "sales-basics", minScorePercent: 80 }, { courseKey: "other", minScorePercent: 80, branchId: southId }] });
    assert.equal((await southEmployee.raw(`/api/training/files/${uploaded.body.fileId}`)).status, 404, "чужой файл недоступен по прямой ссылке");
    assert.equal((await new TestClient(env).raw(`/api/training/files/${uploaded.body.fileId}`)).status, 401);
});

test("подсчёт результата: точное совпадение набора ответов и округление вниз", () => {
    const content = parseCourseContent({
        lessons: [{ key: "l", title: "Урок", body: "" }],
        test: {
            passPercent: 67,
            questions: ["q1", "q2", "q3"].map((key) => ({ key, text: key, kind: "multiple", options: [{ key: "a", text: "A" }, { key: "b", text: "B" }], correct: ["a", "b"] })),
        },
    });
    const score = scoreAnswers(content, { q1: ["a", "b"], q2: ["b", "a"], q3: ["a"] });
    assert.deepEqual(score, { correct: 2, total: 3, percent: 66 }, "2/3 = 66%, а не 67%; частичный ответ не засчитывается");
});
