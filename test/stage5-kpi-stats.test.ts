import assert from "node:assert/strict";
import test from "node:test";
import { addDays, currentMonth, formatLocalDate } from "../lib/time.ts";
import { evaluate, toRpn, type Token } from "../server/kpi.ts";
import { emptyValues } from "../server/metrics.ts";
import { bootstrapDirector, createTestEnv, invite, type TestClient } from "./support/client.ts";

type Lead = { id: string; version: number; number: number };
type Values = Record<string, number>;
type Stats = {
    totals: { values: Values; conversion: { value: number | null; reason: string | null }; avgCheck: { value: number | null; reason: string | null } };
    employees: Array<{ userId: string; name: string; values: Values }>;
};
type Report = { configured: boolean; rows: Array<{ userId: string; name: string; version: { version: number } | null; indicators: Array<{ key: string; fact: number | null; plan: number | null; percent: number | null; reason: string | null }> }> };

let op = 0;
const opId = () => `kpi-${Date.now()}-${(op += 1)}-xxxxxx`;

async function win(client: TestClient, name: string, amount: number): Promise<Lead> {
    let lead = (await client.post<{ lead: Lead }>("/api/crm/leads", { opId: opId(), clientName: name })).body.lead;
    for (const changes of [{ stage: "contact", nextContactAt: Date.now() + 86_400_000 }, { stage: "proposal", amount }, { stage: "won" }]) {
        const result = await client.patch<{ lead: Lead }>(`/api/crm/leads/${lead.id}`, { opId: opId(), version: lead.version, changes });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        lead = result.body.lead;
    }
    return lead;
}

async function setup() {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);
    const north = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север" })).body.branch.id;
    const south = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг" })).body.branch.id;
    const manager = await invite(env, director, { role: "manager", branchId: north }, "north.manager", "Мария Руководитель");
    const ivan = await invite(env, manager, { role: "employee" }, "ivan", "Иван Пекарев");
    const olga = await invite(env, manager, { role: "employee" }, "olga", "Ольга Кондитерова");
    const southManager = await invite(env, director, { role: "manager", branchId: south }, "south.manager", "Пётр Южный");
    const southEmployee = await invite(env, director, { role: "employee", branchId: south }, "south.employee", "Светлана Южная");
    const id = (login: string) => (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = ?").get(login) as { id: string }).id;
    for (const login of ["ivan", "olga", "south.employee"]) await director.put(`/api/users/${id(login)}/admission`, { admitted: true });

    await win(ivan, "Сделка Ивана 1", 100_000);
    await win(ivan, "Сделка Ивана 2", 50_000);
    await win(olga, "Сделка Ольги", 30_000);
    const lost = (await ivan.post<{ lead: Lead }>("/api/crm/leads", { opId: opId(), clientName: "Отказ Ивана" })).body.lead;
    await ivan.patch(`/api/crm/leads/${lost.id}`, { opId: opId(), version: lost.version, changes: { stage: "lost", lostReason: "Дорого" } });
    await ivan.post("/api/crm/leads", { opId: opId(), clientName: "Просрочка Ивана", nextContactAt: Date.now() - 3_600_000 });
    await win(southEmployee, "Сделка Юга", 70_000);
    return { env, director, manager, ivan, olga, southManager, southEmployee, north, south, id };
}

test("формулы KPI: порядок операций, скобки, деление на ноль, ошибки", () => {
    const values = { ...emptyValues(), leads_won: 3, leads_closed: 4, revenue_won: 180_000 };
    const f = (tokens: Token[]) => evaluate(tokens, values);
    assert.deepEqual(f([{ t: "field", v: "revenue_won" }, { t: "op", v: "/" }, { t: "field", v: "leads_won" }]), { value: 60_000, reason: null });
    assert.deepEqual(
        f([{ t: "field", v: "leads_won" }, { t: "op", v: "*" }, { t: "num", v: 100 }, { t: "op", v: "/" }, { t: "field", v: "leads_closed" }]),
        { value: 75, reason: null }
    );
    assert.deepEqual(f([{ t: "paren", v: "(" }, { t: "num", v: 1 }, { t: "op", v: "+" }, { t: "num", v: 2 }, { t: "paren", v: ")" }, { t: "op", v: "*" }, { t: "num", v: 3 }]).value, 9);
    assert.deepEqual(f([{ t: "num", v: 1 }, { t: "op", v: "/" }, { t: "field", v: "leads_lost" }]), { value: null, reason: "divByZero" });
    assert.throws(() => toRpn([{ t: "field", v: "leads_won" }, { t: "op", v: "+" }]));
    assert.throws(() => toRpn([{ t: "paren", v: "(" }, { t: "num", v: 1 }]));
    assert.throws(() => toRpn([{ t: "num", v: 1 }, { t: "num", v: 2 }]));
});

test("статистика: права сначала, потом расчёт; итоги, конверсия, «—» с причиной", async () => {
    const { director, manager, ivan, southManager, north, id } = await setup();
    assert.equal((await ivan.get("/api/stats")).status, 403, "сотруднику статистика недоступна");
    assert.equal((await southManager.get(`/api/stats?branchId=${north}`)).status, 403, "чужой филиал недоступен");

    const northStats = await manager.get<Stats>("/api/stats");
    assert.equal(northStats.status, 200);
    const t = northStats.body.totals;
    assert.deepEqual([t.values["leads_created"], t.values["leads_won"], t.values["leads_lost"], t.values["revenue_won"], t.values["overdue_contacts"]], [5, 3, 1, 180_000, 1]);
    assert.equal(t.conversion.value, 0.75);
    assert.equal(t.avgCheck.value, 60_000);
    const ivanRow = northStats.body.employees.find((row) => row.userId === id("ivan"))!;
    assert.deepEqual([ivanRow.values["leads_won"], ivanRow.values["leads_lost"], ivanRow.values["revenue_won"]], [2, 1, 150_000]);
    assert.ok(!northStats.body.employees.some((row) => row.name === "Светлана Южная"), "сотрудники чужого филиала не попадают в срез");

    const all = await director.get<Stats>("/api/stats?branchId=*");
    assert.equal(all.body.totals.values["leads_won"], 4, "директор: «Все филиалы»");
    assert.equal(all.body.totals.values["revenue_won"], 250_000);

    const empty = await manager.get<Stats>("/api/stats?from=2020-01-01&to=2020-01-31");
    assert.equal(empty.body.totals.conversion.value, null);
    assert.equal(empty.body.totals.conversion.reason, "noClosed", "пустой знаменатель — «—» с причиной");
    assert.equal((await manager.get("/api/stats?from=2026-02-01&to=2025-01-01")).status, 400);

    // Переход к исходным сделкам — тот же расчёт
    const drill = await manager.get<{ leads: Array<{ clientName: string }>; total: number }>(`/api/stats/leads?metric=leads_won&owner=${id("ivan")}`);
    assert.deepEqual(drill.body.leads.map((lead) => lead.clientName).sort(), ["Сделка Ивана 1", "Сделка Ивана 2"]);
    const revenue = await manager.get<{ total: number }>("/api/stats/leads?metric=revenue_won");
    assert.equal(revenue.body.total, t.values["revenue_won"], "сумма исходных сделок совпадает с показателем");
    assert.equal((await southManager.get(`/api/stats/leads?metric=leads_won&branchId=${north}`)).status, 403, "исходные сделки чужого филиала недоступны");
});

test("KPI: подсказка без методики, версии, утверждение, совпадение со статистикой", async () => {
    const { env, director, manager, ivan, olga, southManager, north, id } = await setup();
    const before = await manager.get<Report>("/api/kpi/report");
    assert.equal(before.body.configured, false, "без методики — подсказка, что настроить");
    assert.equal((await ivan.get<Report>("/api/kpi/report")).body.configured, false);

    const indicators = [
        { key: "deals", title: "Сделки", unit: "count", plan: 4, formula: [{ t: "field", v: "leads_won" }] },
        { key: "avg", title: "Средний чек", unit: "money", plan: 50_000, formula: [{ t: "field", v: "revenue_won" }, { t: "op", v: "/" }, { t: "field", v: "leads_won" }] },
    ];
    assert.equal((await manager.post("/api/kpi/methodology", { scope: "company", indicators })).status, 403, "руководитель не меняет общую методику");
    assert.equal((await southManager.post("/api/kpi/methodology", { scope: north, indicators })).status, 403, "и методику чужого филиала");
    assert.equal((await manager.post("/api/kpi/methodology", { scope: north, indicators: [{ ...indicators[0], formula: [{ t: "op", v: "+" }] }] })).status, 400);
    assert.equal((await ivan.post("/api/kpi/methodology", { scope: north, indicators })).status, 403);

    const saved = await manager.post<{ id: string }>("/api/kpi/methodology", { scope: north, indicators });
    assert.equal(saved.status, 200);
    assert.equal((await manager.get<Report>("/api/kpi/report")).body.configured, false, "черновик не применяется к расчётам");
    assert.equal((await manager.post(`/api/kpi/methodology/${saved.body.id}/approve`)).status, 200);

    const report = await manager.get<Report>("/api/kpi/report");
    const stats = await manager.get<Stats>("/api/stats");
    for (const login of ["ivan", "olga"]) {
        const row = report.body.rows.find((item) => item.userId === id(login))!;
        const statsRow = stats.body.employees.find((item) => item.userId === id(login))!;
        assert.equal(row.indicators[0]!.fact, statsRow.values["leads_won"], `KPI «Сделки» = статистика «Сделки» (${login})`);
    }
    const ivanRow = report.body.rows.find((item) => item.userId === id("ivan"))!;
    assert.deepEqual([ivanRow.indicators[0]!.fact, ivanRow.indicators[0]!.plan, ivanRow.indicators[0]!.percent], [2, 4, 50]);
    assert.equal(ivanRow.indicators[1]!.fact, 75_000);
    const managerRow = report.body.rows.find((item) => item.userId === id("north.manager"))!;
    assert.deepEqual([managerRow.indicators[1]!.fact, managerRow.indicators[1]!.reason], [null, "divByZero"], "деление на ноль — «—» с причиной");

    // Сотрудник видит только свой отчёт
    const own = await ivan.get<Report>(`/api/kpi/report?userId=${id("olga")}`);
    assert.deepEqual(own.body.rows.map((row) => row.userId), [id("ivan")]);
    assert.equal((await olga.get("/api/kpi/methodology")).status, 403);

    // Новая версия не переписывает прошлые расчёты
    const month = currentMonth("Asia/Almaty", Date.now());
    const lastMonthEnd = addDays(month.from, -1);
    const lastMonthStart = { ...lastMonthEnd, day: 1 };
    env.DB.sqlite.prepare("UPDATE kpi_versions SET approved_at = ? WHERE id = ?").run(Date.UTC(lastMonthStart.year, lastMonthStart.month - 1, 5), saved.body.id);
    const v2 = await director.post<{ id: string }>("/api/kpi/methodology", { scope: north, indicators: [{ ...indicators[0], plan: 10 }] });
    await director.post(`/api/kpi/methodology/${v2.body.id}/approve`);
    const past = await manager.get<Report>(`/api/kpi/report?from=${formatLocalDate(lastMonthStart)}&to=${formatLocalDate(lastMonthEnd)}`);
    assert.equal(past.body.rows[0]!.version!.version, 1, "прошлый период — по версии 1");
    const current = await manager.get<Report>("/api/kpi/report");
    assert.equal(current.body.rows[0]!.version!.version, 2, "текущий период — по утверждённой версии 2");
    assert.equal(current.body.rows.find((row) => row.userId === id("ivan"))!.indicators[0]!.plan, 10);
});
