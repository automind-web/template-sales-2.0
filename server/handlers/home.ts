/**
 * Главная: сводка системы по роли — числа месяца (той же функцией, что KPI и статистика),
 * дела на сегодня, обучение команды, состояние WhatsApp и первые шаги директора.
 */
import { and, asc, count, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { admissions, companies, leads, users } from "../../db/schema.ts";
import { resolveBranchScope } from "../access.ts";
import { requireActor, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { employeesSeeBranch, getFunnel, isTerminal } from "../crm/funnel.ts";
import { toViews } from "../crm/leads.ts";
import { computeMetrics } from "../metrics.ts";
import { currentMonth, periodBounds, todayBounds } from "../../lib/time.ts";

async function scopeOf(ctx: Ctx, actor: Actor): Promise<{ branchIds: string[] | "all"; ownerUserId: string | null }> {
    if (actor.role === "employee") {
        const own = !(await employeesSeeBranch(ctx.db, actor.companyId));
        return { branchIds: actor.branchId ? [actor.branchId] : [], ownerUserId: own ? actor.userId : null };
    }
    const scope = await resolveBranchScope(ctx, actor, null, { allowAll: true });
    return { branchIds: scope.kind === "all" ? "all" : [scope.branchId], ownerUserId: null };
}

export async function home(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee" && !actor.admitted) return { gated: true };
    const [company, funnel, scope] = await Promise.all([
        ctx.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, actor.companyId)).get(),
        getFunnel(ctx.db, actor.companyId),
        scopeOf(ctx, actor),
    ]);
    const timezone = company?.timezone ?? "UTC";
    const month = currentMonth(timezone, ctx.now);
    const monthBounds = periodBounds(timezone, month.from, month.to);
    const today = todayBounds(timezone, ctx.now);
    const base = { companyId: actor.companyId, branchIds: scope.branchIds, ownerUserId: scope.ownerUserId, now: ctx.now };
    const inScope = (conditions: SQL[]) => {
        if (scope.branchIds !== "all") conditions.push(scope.branchIds.length ? inArray(leads.branchId, scope.branchIds) : sql`1 = 0`);
        if (scope.ownerUserId) conditions.push(eq(leads.ownerUserId, scope.ownerUserId));
        return conditions;
    };

    // Дела: просроченные и сегодняшние контакты по открытым заявкам
    const terminal = funnel.stages.filter((stage) => stage.terminal).map((stage) => stage.key);
    const agendaConditions = inScope([eq(leads.companyId, actor.companyId), lt(leads.nextContactAt, today.to)]);
    if (terminal.length) agendaConditions.push(sql`${leads.stage} NOT IN (${sql.join(terminal.map((key) => sql`${key}`), sql`, `)})`);

    // Все части сводки независимы — запрашиваются параллельно.
    const [monthly, daily, agendaRows, recentRows, team, director] = await Promise.all([
        computeMetrics(ctx.db, { ...base, ...monthBounds }, funnel).then((result) => result.totals),
        computeMetrics(ctx.db, { ...base, ...today }, funnel).then((result) => result.totals),
        ctx.db.select().from(leads).where(and(...agendaConditions)).orderBy(asc(leads.nextContactAt)).limit(8).all(),
        ctx.db.select().from(leads).where(and(...inScope([eq(leads.companyId, actor.companyId)]))).orderBy(desc(leads.createdAt)).limit(5).all(),
        actor.role === "employee" ? Promise.resolve(null) : teamTraining(ctx, actor, scope.branchIds),
        actor.role === "director" ? directorSummary(ctx, actor, today.from) : Promise.resolve(null),
    ]);
    const unassigned = actor.role === "employee" ? 0 : recentRows.filter((row) => !row.ownerUserId && !isTerminal(funnel, row.stage)).length;
    const [agenda, recent] = await Promise.all([toViews(ctx.db, agendaRows, funnel, ctx.now), toViews(ctx.db, recentRows, funnel, ctx.now)]);

    return {
        gated: false,
        timezone,
        now: ctx.now,
        month: { values: monthly },
        today: { created: daily.leads_created, won: daily.leads_won },
        agenda,
        recent,
        unassigned,
        funnel,
        team,
        whatsapp: director?.whatsapp ?? null,
        setup: director?.setup ?? null,
    };
}

/** Обучение команды: сколько сотрудников и сколько из них прошли обучение (один запрос) */
async function teamTraining(ctx: Ctx, actor: Actor, branchIds: string[] | "all") {
    const people = [eq(users.companyId, actor.companyId), eq(users.role, "employee"), eq(users.status, "active")];
    if (branchIds !== "all") people.push(branchIds.length ? inArray(users.branchId, branchIds) : sql`1 = 0`);
    const row = await ctx.db
        .select({
            employees: count(),
            trained: sql<number>`coalesce(sum(exists (select 1 from ${admissions} where ${admissions.userId} = ${users.id} and ${admissions.revokedAt} is null)), 0)`,
        })
        .from(users)
        .where(and(...people))
        .get();
    return { employees: Number(row?.employees ?? 0), trained: Number(row?.trained ?? 0) };
}

/** Директору: состояние WhatsApp-агентов и первые шаги — одним обращением к базе */
async function directorSummary(ctx: Ctx, actor: Actor, todayFrom: number) {
    const row = await ctx.env.DB.prepare(
        `SELECT
            (SELECT count(*) FROM agents WHERE owner_id = ?1) AS agents,
            (SELECT coalesce(sum(enabled), 0) FROM agents WHERE owner_id = ?1) AS enabled,
            (SELECT count(*) FROM agents WHERE owner_id = ?1 AND whapi_status = 'connected') AS connected,
            (SELECT count(*) FROM conversations c JOIN agents a ON a.id = c.agent_id WHERE a.owner_id = ?1 AND c.last_message_at >= ?2) AS chats,
            (SELECT count(*) FROM branches WHERE company_id = ?1 AND archived_at IS NULL) AS branches,
            (SELECT count(*) FROM users WHERE company_id = ?1 AND status = 'active') AS people`
    )
        .bind(actor.companyId, todayFrom)
        .first<{ agents: number; enabled: number; connected: number; chats: number; branches: number; people: number }>();
    const agents = Number(row?.agents ?? 0);
    return {
        whatsapp: { agents, enabled: Number(row?.enabled ?? 0), connected: Number(row?.connected ?? 0), chatsToday: Number(row?.chats ?? 0) },
        setup: { branches: Number(row?.branches ?? 0), people: Number(row?.people ?? 0), agents },
    };
}

/** Короткие отметки для меню: просроченные контакты и работа WhatsApp-агента */
export async function navStatus(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee" && !actor.admitted) return { overdue: 0, whatsapp: null };
    const [funnel, scope] = await Promise.all([getFunnel(ctx.db, actor.companyId), scopeOf(ctx, actor)]);
    const terminal = funnel.stages.filter((stage) => stage.terminal).map((stage) => stage.key);
    const conditions: SQL[] = [eq(leads.companyId, actor.companyId), lt(leads.nextContactAt, ctx.now)];
    if (scope.branchIds !== "all") conditions.push(scope.branchIds.length ? inArray(leads.branchId, scope.branchIds) : sql`1 = 0`);
    if (scope.ownerUserId) conditions.push(eq(leads.ownerUserId, scope.ownerUserId));
    if (terminal.length) conditions.push(sql`${leads.stage} NOT IN (${sql.join(terminal.map((key) => sql`${key}`), sql`, `)})`);
    const [overdueRow, agents] = await Promise.all([
        ctx.db.select({ n: count() }).from(leads).where(and(...conditions)).get(),
        actor.role === "director"
            ? ctx.env.DB.prepare("SELECT coalesce(sum(enabled), 0) AS enabled, count(*) AS total FROM agents WHERE owner_id = ?").bind(actor.companyId).first<{ enabled: number; total: number }>()
            : Promise.resolve(null),
    ]);
    const whatsapp: "on" | "off" | null = !agents || Number(agents.total) === 0 ? null : Number(agents.enabled) > 0 ? "on" : "off";
    return { overdue: Number(overdueRow?.n ?? 0), whatsapp };
}
