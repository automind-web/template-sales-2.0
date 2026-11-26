import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDirector, createTestEnv, invite } from "./support/client.ts";

type Lead = { id: string; number: number; stage: string; version: number; ownerUserId: string | null; ownerName: string | null; nextContactAt: number | null; amount: number | null; overdue: boolean; clientName: string };
type Detail = { lead: Lead; history: Array<{ type: string; oldValue: string | null; newValue: string | null; actorName: string | null; field: string | null }>; repeated: boolean };
type List = { leads: Lead[]; counts: Record<string, number>; total: number };
type ErrorBody = { error?: { code: string; message: string; fields?: Record<string, string>; lead?: Lead; missing?: string[] } };

let op = 0;
const opId = () => `op-${Date.now()}-${(op += 1)}-xxxxxxxx`;

async function setup() {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);
    const north = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север" })).body.branch.id;
    const south = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг" })).body.branch.id;
    const manager = await invite(env, director, { role: "manager", branchId: north }, "north.manager", "Мария Руководитель");
    const ivan = await invite(env, manager, { role: "employee" }, "ivan", "Иван Пекарев");
    const olga = await invite(env, manager, { role: "employee" }, "olga", "Ольга Кондитерова");
    const southManager = await invite(env, director, { role: "manager", branchId: south }, "south.manager", "Пётр Южный");
    const id = (login: string) => (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = ?").get(login) as { id: string }).id;
    await director.put(`/api/users/${id("ivan")}/admission`, { admitted: true });
    await director.put(`/api/users/${id("olga")}/admission`, { admitted: true });
    await director.put("/api/me/branch", { branchId: north });
    return { env, director, manager, ivan, olga, southManager, north, south, id };
}

test("CRM: допуск, выбор филиала директором, создание с идемпотентностью", async () => {
    const { env, director, ivan, id } = await setup();
    const newbie = await invite(env, director, { role: "employee", branchId: (env.DB.sqlite.prepare("SELECT id FROM branches WHERE name='Север'").get() as { id: string }).id }, "newbie");
    assert.equal((await newbie.get("/api/crm/config")).status, 403, "до допуска CRM закрыт");

    await director.put("/api/me/branch", { branchId: "*" });
    const all = await director.get<ErrorBody>("/api/crm/leads");
    assert.equal(all.status, 400, "в CRM директор работает с одним филиалом");
    await director.put("/api/me/branch", { branchId: (env.DB.sqlite.prepare("SELECT id FROM branches WHERE name='Север'").get() as { id: string }).id });

    const config = await ivan.get<{ funnel: { stages: Array<{ key: string }> }; owners: Array<{ id: string }>; canAssign: boolean; ownOnly: boolean }>("/api/crm/config");
    assert.equal(config.status, 200);
    assert.equal(config.body.funnel.stages[0]!.key, "new");
    assert.ok(!config.body.owners.some((owner) => owner.id === id("newbie")), "недопущенному лид не поручить");
    assert.deepEqual([config.body.canAssign, config.body.ownOnly], [false, true]);

    const key = opId();
    const created = await ivan.post<Detail>("/api/crm/leads", { opId: key, clientName: "ООО «Ромашка»", clientPhone: "+7 (701) 111-22-33", amount: 150000 });
    assert.equal(created.status, 200);
    assert.equal(created.body.lead.number, 1);
    assert.equal(created.body.lead.ownerUserId, id("ivan"), "сотрудник создаёт лид на себя");
    const again = await ivan.post<Detail>("/api/crm/leads", { opId: key, clientName: "ООО «Ромашка»" });
    assert.equal(again.body.repeated, true);
    assert.equal(again.body.lead.id, created.body.lead.id);
    const count = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
    assert.equal(count.n, 1, "повтор создания не создаёт второй лид");
    assert.equal((await ivan.post("/api/crm/leads", { opId: opId(), clientName: "" })).status, 400);
    assert.equal((await ivan.post("/api/crm/leads", { clientName: "Без операции" })).status, 400, "запись без идентификатора операции отклоняется");
});

test("CRM: переходы, обязательные поля, история, конфликт версий, повтор операции", async () => {
    const { env, ivan, manager, id } = await setup();
    const lead = (await ivan.post<Detail>("/api/crm/leads", { opId: opId(), clientName: "Клиент А" })).body.lead;

    const forbidden = await ivan.patch<ErrorBody>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: lead.version, changes: { stage: "won" } });
    assert.equal(forbidden.status, 422);
    assert.equal(forbidden.body.error?.code, "crm.transitionForbidden");
    assert.match(forbidden.body.error!.message, /«Новый» в «Сделка»/);

    const missing = await ivan.patch<ErrorBody>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: lead.version, changes: { stage: "contact" } });
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.body.error?.missing, ["nextContactAt"]);

    const when = Date.now() + 86_400_000;
    const key = opId();
    const moved = await ivan.patch<Detail>(`/api/crm/leads/${lead.id}`, { opId: key, version: lead.version, changes: { stage: "contact", nextContactAt: when }, comment: "Позвонил, просит перезвонить" });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.lead.stage, "contact");
    assert.equal(moved.body.lead.version, 2);
    const stageEvent = moved.body.history.find((event) => event.type === "stage")!;
    assert.deepEqual([stageEvent.oldValue, stageEvent.newValue, stageEvent.actorName], ["new", "contact", "Иван Пекарев"], "история: автор и прежнее значение");
    assert.ok(moved.body.history.some((event) => event.type === "next_contact" && event.oldValue === null && event.newValue === String(when)));
    assert.ok(moved.body.history.some((event) => event.type === "comment" && event.newValue === "Позвонил, просит перезвонить"));

    // Повтор нажатия / доставки той же операции
    const eventsBefore = (env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM lead_events WHERE lead_id = ?").get(lead.id) as { n: number }).n;
    const repeat = await ivan.patch<Detail>(`/api/crm/leads/${lead.id}`, { opId: key, version: lead.version, changes: { stage: "contact", nextContactAt: when } });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.repeated, true);
    const eventsAfter = (env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM lead_events WHERE lead_id = ?").get(lead.id) as { n: number }).n;
    assert.equal(eventsAfter, eventsBefore, "повтор операции не создаёт событий");

    // Устаревшая версия → 409 с актуальным состоянием
    const stale = await manager.patch<ErrorBody>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: 1, changes: { amount: 100 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error?.lead?.version, 2);
    assert.equal(stale.body.error?.lead?.stage, "contact");

    // Две разные операции с одной версией: проходит одна
    const results = await Promise.all([
        manager.patch(`/api/crm/leads/${lead.id}`, { opId: opId(), version: 2, changes: { amount: 500 } }),
        ivan.patch(`/api/crm/leads/${lead.id}`, { opId: opId(), version: 2, changes: { amount: 700 } }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);

    // Ответственного меняет только руководитель
    const current = (await ivan.get<Detail>(`/api/crm/leads/${lead.id}`)).body.lead;
    assert.equal((await ivan.patch(`/api/crm/leads/${lead.id}`, { opId: opId(), version: current.version, changes: { ownerUserId: id("olga") } })).status, 403);
    const reassigned = await manager.patch<Detail>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: current.version, changes: { ownerUserId: id("olga") } });
    assert.equal(reassigned.body.lead.ownerName, "Ольга Кондитерова");
    assert.equal((await ivan.get(`/api/crm/leads/${lead.id}`)).status, 404, "после передачи лид пропал у прежнего сотрудника (видимость «только свои»)");

    // Отказ требует причину; закрытие фиксирует ответственного
    const v = reassigned.body.lead.version;
    assert.equal((await manager.patch(`/api/crm/leads/${lead.id}`, { opId: opId(), version: v, changes: { stage: "lost" } })).status, 422);
    const lost = await manager.patch<Detail>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: v, changes: { stage: "lost", lostReason: "Дорого" } });
    assert.equal(lost.body.lead.stage, "lost");
    const closed = env.DB.sqlite.prepare("SELECT closed_at, closed_owner_user_id FROM leads WHERE id = ?").get(lead.id) as { closed_at: number; closed_owner_user_id: string };
    assert.ok(closed.closed_at > 0);
    assert.equal(closed.closed_owner_user_id, id("olga"));
});

test("CRM: список и канбан — один запрос; поиск, фильтры, просрочка; изоляция и выгрузка", async () => {
    const { ivan, olga, manager, director, southManager } = await setup();
    const past = Date.now() - 3_600_000;
    const a = (await ivan.post<Detail>("/api/crm/leads", { opId: opId(), clientName: "Пекарня ЁЛКА", clientPhone: "8 701 555 00 11", nextContactAt: past })).body.lead;
    await ivan.post<Detail>("/api/crm/leads", { opId: opId(), clientName: "=HYPERLINK(\"x\")" });
    const c = (await olga.post<Detail>("/api/crm/leads", { opId: opId(), clientName: "Кафе Ольги" })).body.lead;

    const own = await ivan.get<List>("/api/crm/leads");
    assert.equal(own.body.total, 2, "сотрудник видит только свои лиды");
    assert.equal((await ivan.get(`/api/crm/leads/${c.id}`)).status, 404, "чужой лид по прямой ссылке недоступен");
    const team = await manager.get<List>("/api/crm/leads");
    assert.equal(team.body.total, 3);
    assert.equal(team.body.counts["new"], 3);

    const search = async (q: string) => (await manager.get<List>(`/api/crm/leads?q=${encodeURIComponent(q)}`)).body.leads.map((lead) => lead.clientName);
    assert.deepEqual(await search("ёлка"), ["Пекарня ЁЛКА"], "поиск без учёта регистра по кириллице");
    assert.deepEqual(await search("7015550011"), ["Пекарня ЁЛКА"], "поиск по цифрам телефона");
    assert.deepEqual(await search(`#${c.number}`), ["Кафе Ольги"], "поиск по номеру");
    const overdue = await manager.get<List>("/api/crm/leads?due=overdue");
    assert.deepEqual(overdue.body.leads.map((lead) => lead.id), [a.id]);
    assert.equal(overdue.body.leads[0]!.overdue, true);
    const byStage = await manager.get<List>("/api/crm/leads?stage=contact");
    assert.equal(byStage.body.total, 0);
    assert.equal(byStage.body.counts["new"], 3, "счётчики этапов не зависят от фильтра этапа");

    // Чужой филиал: руководитель Юга не видит лиды Севера ни списком, ни по ссылке
    assert.equal((await southManager.get(`/api/crm/leads/${a.id}`)).status, 404);
    assert.equal((await southManager.get<List>("/api/crm/leads")).body.total, 0);
    const northId = (await director.get<{ branch: { id: string } }>("/api/crm/config")).body.branch.id;
    assert.equal((await southManager.get(`/api/crm/leads?branchId=${northId}`)).status, 403);
    assert.equal((await southManager.get(`/api/crm/export?branchId=${northId}`)).status, 403, "выгрузка чужого филиала запрещена");

    // Выгрузка — те же права и фильтры
    const csv = await ivan.raw("/api/crm/export");
    const body = await csv.text();
    assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.ok(body.includes("Пекарня ЁЛКА") && !body.includes("Кафе Ольги"));
    assert.ok(body.includes(`"'=HYPERLINK(""x"")"`), "формулы в выгрузке нейтрализованы");
});

test("CRM: настройки процесса — названия этапов, запрет удаления используемого этапа, видимость", async () => {
    const { director, manager, ivan, olga } = await setup();
    await olga.post("/api/crm/leads", { opId: opId(), clientName: "Чужой для Ивана" });
    const process = await director.get<{ funnel: { stages: Array<{ key: string; label: string }>; transitions: Record<string, string[]> } }>("/api/settings/process");
    assert.equal(process.status, 200);
    assert.equal((await manager.get("/api/settings/process")).status, 403);

    const renamed = { ...process.body.funnel, stages: process.body.funnel.stages.map((stage) => (stage.key === "contact" ? { ...stage, label: "Первый контакт" } : stage)) };
    assert.equal((await director.put("/api/settings/process", { funnel: renamed })).status, 200);
    const config = await ivan.get<{ funnel: { stages: Array<{ key: string; label: string }> } }>("/api/crm/config");
    assert.equal(config.body.funnel.stages.find((stage) => stage.key === "contact")!.label, "Первый контакт");

    const withoutNew = { ...renamed, stages: renamed.stages.filter((stage) => stage.key !== "new") };
    const rejected = await director.put<ErrorBody>("/api/settings/process", { funnel: withoutNew });
    assert.equal(rejected.status, 400, "нельзя удалить этап, в котором есть лиды");

    assert.equal((await ivan.get<List>("/api/crm/leads")).body.total, 0);
    await director.put("/api/settings/process", { employeesSeeBranch: true });
    assert.equal((await ivan.get<List>("/api/crm/leads")).body.total, 1, "после настройки сотрудник видит лиды коллег филиала");
});
