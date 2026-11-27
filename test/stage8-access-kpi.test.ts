import assert from "node:assert/strict";
import test from "node:test";
import { addDays, currentMonth, formatLocalDate, localDateOf } from "../lib/time.ts";
import { bootstrapDirector, createTestEnv, invite, OWNER_CODE, TestClient, tokenFromPath } from "./support/client.ts";

type ErrorBody = { error?: { code: string; message: string } };
let op = 0;
const opId = () => `acc-${Date.now()}-${(op += 1)}-xxxxxx`;

async function setup() {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);
    const north = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север" })).body.branch.id;
    const south = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг" })).body.branch.id;
    const manager = await invite(env, director, { role: "manager", branchId: north }, "north.manager", "Мария Руководитель");
    const ivan = await invite(env, manager, { role: "employee" }, "ivan", "Иван Пекарев");
    const olga = await invite(env, manager, { role: "employee" }, "olga", "Ольга Кондитерова");
    const southEmployee = await invite(env, director, { role: "employee", branchId: south }, "south.employee", "Светлана Южная");
    const id = (login: string) => (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = ?").get(login) as { id: string }).id;
    for (const login of ["ivan", "olga", "south.employee"]) await director.put(`/api/users/${id(login)}/admission`, { admitted: true });
    await director.put("/api/me/branch", { branchId: north });
    return { env, director, manager, ivan, olga, southEmployee, north, south, id };
}

test("пароль от 8 символов", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.9.9.9");
    const issued = await owner.post<{ path: string }>("/api/owner/activation-links", { code: OWNER_CODE });
    const visitor = new TestClient(env);
    const seven = await visitor.post<ErrorBody>(`/api/invitations/by-token/${tokenFromPath(issued.body.path)}/accept`, { displayName: "Директор", login: "boss", password: "1234567" });
    assert.equal(seven.status, 400);
    const eight = await visitor.post(`/api/invitations/by-token/${tokenFromPath(issued.body.path)}/accept`, { displayName: "Директор", login: "boss", password: "12345678" });
    assert.equal(eight.status, 200, "8 символов — достаточно");
});

test("первичная активация директора — один раз; действует только последняя ссылка; восстановление через владельца", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.9.9.9");
    assert.equal((await owner.get<{ activated: boolean }>("/api/owner/status")).body.activated, false);
    const first = await owner.post<{ path: string }>("/api/owner/activation-links", { code: OWNER_CODE });
    const second = await owner.post<{ path: string }>("/api/owner/activation-links", { code: OWNER_CODE });
    const visitor = new TestClient(env, "10.1.1.1");
    const old = await visitor.post<ErrorBody>(`/api/invitations/by-token/${tokenFromPath(first.body.path)}/accept`, { displayName: "Первый", login: "first", password: "password-1" });
    assert.equal(old.status, 410, "прежняя ссылка отключена новой");
    const ok = await visitor.post(`/api/invitations/by-token/${tokenFromPath(second.body.path)}/accept`, { displayName: "Директор", login: "boss", password: "password-1" });
    assert.equal(ok.status, 200);
    assert.equal((await owner.get<{ activated: boolean }>("/api/owner/status")).body.activated, true);
    const again = await new TestClient(env, "10.9.9.8").post<ErrorBody>("/api/owner/activation-links", { code: OWNER_CODE });
    assert.equal(again.status, 409, "после активации новые ссылки не выпускаются");
    assert.equal(again.body.error?.code, "owner.alreadyActivated");

    const reset = await new TestClient(env, "10.9.9.7").post<{ code: string }>("/api/owner/director-reset", { code: OWNER_CODE, login: "boss" });
    assert.equal(reset.status, 200);
    const changed = await new TestClient(env, "10.2.2.2").post("/api/auth/reset", { login: "boss", code: reset.body.code, password: "new-password-1" });
    assert.equal(changed.status, 200, "директор восстановил доступ кодом от владельца");
    assert.equal((await new TestClient(env, "10.9.9.6").post("/api/owner/director-reset", { code: "wrong", login: "boss" })).status, 403);
});

test("перевыпуск приглашения: новая ссылка, старая отключена; руководитель — только своего филиала", async () => {
    const { env, director, manager, south } = await setup();
    const created = await manager.post<{ id: string; path: string }>("/api/invitations", { role: "employee" });
    const reissued = await manager.post<{ id: string; path: string }>(`/api/invitations/${created.body.id}/reissue`, {});
    assert.equal(reissued.status, 200);
    assert.notEqual(reissued.body.path, created.body.path);
    const visitor = new TestClient(env, "10.3.3.3");
    assert.equal((await visitor.get(`/api/invitations/by-token/${tokenFromPath(created.body.path)}`)).status, 410, "старая ссылка не работает");
    assert.equal((await visitor.get(`/api/invitations/by-token/${tokenFromPath(reissued.body.path)}`)).status, 200);
    const southInvite = await director.post<{ id: string }>("/api/invitations", { role: "employee", branchId: south });
    assert.equal((await manager.post(`/api/invitations/${southInvite.body.id}/reissue`, {})).status, 404, "чужой филиал руководителю недоступен");
    await visitor.post(`/api/invitations/by-token/${tokenFromPath(reissued.body.path)}/accept`, { displayName: "Новый", login: "newbie", password: "password-1" });
    assert.equal((await manager.post(`/api/invitations/${reissued.body.id}/reissue`, {})).status, 409, "использованное приглашение не перевыпускается");
});

test("рабочие роли: директор создаёт, роль закрывает разделы на сервере; журнал прав", async () => {
    const { director, manager, ivan, id } = await setup();
    assert.equal((await manager.post("/api/work-roles", { name: "Оператор", sections: ["crm"] })).status, 403, "роли создаёт только директор");
    const role = await director.post<{ id: string }>("/api/work-roles", { name: "Оператор", sections: ["crm"] });
    assert.equal(role.status, 200);
    assert.equal((await manager.patch(`/api/users/${id("ivan")}`, { workRoleId: role.body.id })).status, 200, "руководитель назначает роль своему сотруднику");
    assert.equal((await ivan.get("/api/crm/config")).status, 200, "CRM открыт");
    assert.equal((await ivan.get("/api/kpi/report")).status, 403, "KPI закрыт рабочей ролью");
    const me = await ivan.get<{ sections: Record<string, boolean>; user: { workRoleName: string } }>("/api/me");
    assert.deepEqual([me.body.sections["crm"], me.body.sections["kpi"], me.body.user.workRoleName], [true, false, "Оператор"]);
    await director.patch(`/api/work-roles/${role.body.id}`, { archived: true });
    assert.equal((await ivan.get("/api/kpi/report")).status, 200, "роль в архиве ограничений не накладывает");

    await director.put(`/api/users/${id("olga")}/admission`, { admitted: false });
    const log = await director.get<{ entries: Array<{ action: string; text: string; actorName: string | null }> }>("/api/access-log?branchId=*");
    const texts = log.body.entries.map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes("Создана рабочая роль «Оператор»: CRM")));
    assert.ok(texts.some((text) => text.includes("Иван Пекарев: рабочая роль без рабочей роли → Оператор")), texts.join("\n"));
    assert.ok(texts.some((text) => text.includes("Снята отметка «Прошёл обучение»: Ольга Кондитерова")));
    const mine = await manager.get<{ entries: Array<{ text: string }> }>("/api/access-log");
    assert.ok(mine.body.entries.every((entry) => !entry.text.includes("Светлана")), "руководитель видит только свой филиал");
    assert.equal((await ivan.get("/api/access-log")).status, 403);
});

test("KPI: формула сотрудника важнее филиала, дата начала действия, копирование, предпросмотр, прогноз", async () => {
    const { env, director, manager, ivan, olga, id, north } = await setup();
    for (let i = 0; i < 3; i += 1) await ivan.post("/api/crm/leads", { opId: opId(), clientName: `Клиент ${i}` });
    await olga.post("/api/crm/leads", { opId: opId(), clientName: "Клиент О" });
    const formula = (plan: number, title = "Новые заявки") => [{ key: "k1", title, unit: "count", plan, formula: [{ t: "field", v: "leads_created" }] }];

    // Методика филиала
    const branchVersion = await manager.post<{ id: string }>("/api/kpi/methodology", { scope: north, indicators: formula(10) });
    await manager.post(`/api/kpi/methodology/${branchVersion.body.id}/approve`, {});

    // Отдельная формула Ивана
    const ivanScope = `user:${id("ivan")}`;
    const personal = await manager.post<{ id: string }>("/api/kpi/methodology", { scope: ivanScope, indicators: formula(3, "Заявки Ивана") });
    await manager.post(`/api/kpi/methodology/${personal.body.id}/approve`, {});
    type Report = { rows: Array<{ name: string; version: { scope: string } | null; indicators: Array<{ title: string; fact: number; plan: number; percent: number; forecast: number | null; forecastPercent: number | null }> }>; progress: { elapsedDays: number; totalDays: number } };
    let report = await manager.get<Report>("/api/kpi/report");
    const ivanRow = report.body.rows.find((row) => row.name === "Иван Пекарев")!;
    const olgaRow = report.body.rows.find((row) => row.name === "Ольга Кондитерова")!;
    assert.deepEqual([ivanRow.version?.scope, ivanRow.indicators[0]!.title, ivanRow.indicators[0]!.percent], ["user", "Заявки Ивана", 100]);
    assert.deepEqual([olgaRow.version?.scope, olgaRow.indicators[0]!.title], ["branch", "Новые заявки"]);
    assert.ok(report.body.progress.totalDays >= 28);
    assert.ok(ivanRow.indicators[0]!.forecast! >= ivanRow.indicators[0]!.fact, "прогноз не меньше факта");

    // Дата начала в будущем: версия ещё не действует
    const tz = "Asia/Almaty";
    const tomorrow = formatLocalDate(addDays(localDateOf(tz, Date.now()), 1));
    const future = await manager.post<{ id: string }>("/api/kpi/methodology", { scope: ivanScope, indicators: formula(99, "Будущая"), effectiveFrom: tomorrow });
    await manager.post(`/api/kpi/methodology/${future.body.id}/approve`, {});
    report = await manager.get<Report>("/api/kpi/report");
    assert.equal(report.body.rows.find((row) => row.name === "Иван Пекарев")!.indicators[0]!.title, "Заявки Ивана", "текущий месяц считается по версии, действующей на конец периода");
    const month = currentMonth(tz, Date.now());
    const nextMonthFrom = formatLocalDate(addDays(month.to, 1));
    const next = await manager.get<Report>(`/api/kpi/report?from=${nextMonthFrom}&to=${formatLocalDate(addDays(month.to, 28))}`);
    assert.equal(next.body.rows.find((row) => row.name === "Иван Пекарев")!.indicators[0]!.title, "Будущая", "со дня начала действует новая версия");
    assert.equal((await manager.post<ErrorBody>("/api/kpi/methodology", { scope: ivanScope, indicators: formula(1), effectiveFrom: "31.12.2026" })).status, 400);

    // Копирование на нескольких сотрудников
    const copied = await manager.post<{ copied: number }>("/api/kpi/methodology/copy", { indicators: formula(5, "Общая для двоих"), userIds: [id("ivan"), id("olga")] });
    assert.equal(copied.body.copied, 2);
    report = await manager.get<Report>("/api/kpi/report");
    assert.deepEqual(report.body.rows.filter((row) => row.name !== "Мария Руководитель").map((row) => row.indicators[0]!.title).sort(), ["Общая для двоих", "Общая для двоих"]);
    assert.equal((await manager.post("/api/kpi/methodology/copy", { indicators: formula(5), userIds: [id("south.employee")] })).status, 404, "руководителю — только свои сотрудники");
    assert.equal((await ivan.post("/api/kpi/methodology/copy", { indicators: formula(5), userIds: [id("ivan")] })).status, 403);

    // Предпросмотр без сохранения
    const versionsBefore = (env.DB.sqlite.prepare("SELECT count(*) AS n FROM kpi_versions").get() as { n: number }).n;
    const preview = await manager.post<{ rows: Array<{ name: string; indicators: Array<{ fact: number; percent: number }> }> }>("/api/kpi/preview", { scope: ivanScope, indicators: formula(6) });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.rows.map((row) => [row.name, row.indicators[0]!.fact, row.indicators[0]!.percent]), [["Иван Пекарев", 3, 50]]);
    assert.equal((env.DB.sqlite.prepare("SELECT count(*) AS n FROM kpi_versions").get() as { n: number }).n, versionsBefore, "предпросмотр ничего не сохраняет");
    const team = await director.post<{ rows: unknown[] }>("/api/kpi/preview", { scope: north, indicators: formula(6) });
    assert.ok(team.body.rows.length >= 2);

    // Сотрудник видит свой прогноз
    const own = await ivan.get<Report>("/api/kpi/report");
    assert.equal(own.body.rows.length, 1);
    assert.ok(own.body.rows[0]!.indicators[0]!.forecastPercent !== null);
});
