/**
 * Главная: сводка системы по роли — числа месяца (той же функцией, что KPI и статистика),
 * дела на сегодня, обучение команды, состояние WhatsApp и первые шаги директора.
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { admissions, branches, companies, leads, users } from "../../db/schema.ts";
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
    const company = await ctx.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, actor.companyId)).get();
    const timezone = company?.timezone ?? "UTC";
    const funnel = await getFunnel(ctx.db, actor.companyId);
    const scope = await scopeOf(ctx, actor);
    const month = currentMonth(timezone, ctx.now);
    const monthBounds = periodBounds(timezone, month.from, month.to);
    const today = todayBounds(timezone, ctx.now);
    const base = { companyId: actor.companyId, branchIds: scope.branchIds, ownerUserId: scope.ownerUserId, now: ctx.now };
    const monthly = (await computeMetrics(ctx.db, { ...base, ...monthBounds }, funnel)).totals;
    const daily = (await computeMetrics(ctx.db, { ...base, ...today }, funnel)).totals;

    // Дела: просроченные и сегодняшние контакты по открытым заявкам
    const terminal = funnel.stages.filter((stage) => stage.terminal).map((stage) => stage.key);
    const conditions: SQL[] = [eq(leads.companyId, actor.companyId), lt(leads.nextContactAt, today.to)];
    if (scope.branchIds !== "all") conditions.push(scope.branchIds.length ? inArray(leads.branchId, scope.branchIds) : sql`1 = 0`);
    if (scope.ownerUserId) conditions.push(eq(leads.ownerUserId, scope.ownerUserId));
    if (terminal.length) conditions.push(sql`${leads.stage} NOT IN (${sql.join(terminal.map((key) => sql`${key}`), sql`, `)})`);
    const agendaRows = await ctx.db.select().from(leads).where(and(...conditions)).orderBy(asc(leads.nextContactAt)).limit(8).all();

    const recentConditions: SQL[] = [eq(leads.companyId, actor.companyId)];
    if (scope.branchIds !== "all") recentConditions.push(scope.branchIds.length ? inArray(leads.branchId, scope.branchIds) : sql`1 = 0`);
    if (scope.ownerUserId) recentConditions.push(eq(leads.ownerUserId, scope.ownerUserId));
    const recentRows = await ctx.db.select().from(leads).where(and(...recentConditions)).orderBy(desc(leads.createdAt)).limit(5).all();
    const unassigned = actor.role === "employee" ? 0 : recentRows.filter((row) => !row.ownerUserId && !isTerminal(funnel, row.stage)).length;

    let team: { employees: number; trained: number } | null = null;
    if (actor.role !== "employee") {
        const people = [eq(users.companyId, actor.companyId), eq(users.role, "employee"), eq(users.status, "active")];
        if (scope.branchIds !== "all") people.push(scope.branchIds.length ? inArray(users.branchId, scope.branchIds) : sql`1 = 0`);
        const employees = await ctx.db.select({ id: users.id }).from(users).where(and(...people)).all();
        const trained = employees.length
            ? (await ctx.db.select({ n: count() }).from(admissions).where(and(inArray(admissions.userId, employees.map((row) => row.id)), isNull(admissions.revokedAt))).get())?.n ?? 0
            : 0;
        team = { employees: employees.length, trained: Number(trained) };
    }

    let whatsapp: { agents: number; enabled: number; connected: number; chatsToday: number } | null = null;
    let setup: { branches: number; people: number; agents: number } | null = null;
    if (actor.role === "director") {
        const agents = await ctx.env.DB.prepare("SELECT count(*) AS agents, coalesce(sum(enabled), 0) AS enabled, coalesce(sum(CASE WHEN whapi_status = 'connected' THEN 1 ELSE 0 END), 0) AS connected FROM agents WHERE owner_id = ?")
            .bind(actor.companyId)
            .first<{ agents: number; enabled: number; connected: number }>();
        const chats = await ctx.env.DB.prepare("SELECT count(*) AS n FROM conversations c JOIN agents a ON a.id = c.agent_id WHERE a.owner_id = ? AND c.last_message_at >= ?")
            .bind(actor.companyId, today.from)
            .first<{ n: number }>();
        whatsapp = { agents: Number(agents?.agents ?? 0), enabled: Number(agents?.enabled ?? 0), connected: Number(agents?.connected ?? 0), chatsToday: Number(chats?.n ?? 0) };
        const branchCount = (await ctx.db.select({ n: count() }).from(branches).where(and(eq(branches.companyId, actor.companyId), isNull(branches.archivedAt))).get())?.n ?? 0;
        const peopleCount = (await ctx.db.select({ n: count() }).from(users).where(and(eq(users.companyId, actor.companyId), eq(users.status, "active"))).get())?.n ?? 0;
        setup = { branches: Number(branchCount), people: Number(peopleCount), agents: whatsapp.agents };
    }

    return {
        gated: false,
        timezone,
        now: ctx.now,
        month: { values: monthly },
        today: { created: daily.leads_created, won: daily.leads_won },
        agenda: await toViews(ctx.db, agendaRows, funnel, ctx.now),
        recent: await toViews(ctx.db, recentRows, funnel, ctx.now),
        unassigned,
        funnel,
        team,
        whatsapp,
        setup,
    };
}

/** Короткие отметки для меню: просроченные контакты и работа WhatsApp-агента */
export async function navStatus(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee" && !actor.admitted) return { overdue: 0, whatsapp: null };
    const funnel = await getFunnel(ctx.db, actor.companyId);
    const scope = await scopeOf(ctx, actor);
    const terminal = funnel.stages.filter((stage) => stage.terminal).map((stage) => stage.key);
    const conditions: SQL[] = [eq(leads.companyId, actor.companyId), lt(leads.nextContactAt, ctx.now)];
    if (scope.branchIds !== "all") conditions.push(scope.branchIds.length ? inArray(leads.branchId, scope.branchIds) : sql`1 = 0`);
    if (scope.ownerUserId) conditions.push(eq(leads.ownerUserId, scope.ownerUserId));
    if (terminal.length) conditions.push(sql`${leads.stage} NOT IN (${sql.join(terminal.map((key) => sql`${key}`), sql`, `)})`);
    const overdue = (await ctx.db.select({ n: count() }).from(leads).where(and(...conditions)).get())?.n ?? 0;
    let whatsapp: "on" | "off" | null = null;
    if (actor.role === "director") {
        const row = await ctx.env.DB.prepare("SELECT coalesce(sum(enabled), 0) AS enabled, count(*) AS total FROM agents WHERE owner_id = ?").bind(actor.companyId).first<{ enabled: number; total: number }>();
        whatsapp = Number(row?.total ?? 0) === 0 ? null : Number(row?.enabled ?? 0) > 0 ? "on" : "off";
    }
    return { overdue: Number(overdue), whatsapp };
}
