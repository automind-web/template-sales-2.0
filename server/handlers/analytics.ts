/**
 * Статистика и KPI. Сначала права (филиалы, сотрудник), потом расчёт —
 * обе части вызывают computeMetrics из server/metrics.ts.
 */
import { and, eq, inArray } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { branches, companies, kpiVersions, users } from "../../db/schema.ts";
import { currentMonth, formatLocalDate, parseLocalDate, periodBounds, type LocalDate } from "../../lib/time.ts";
import { loadCompanyBranch, requireSection, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { getFunnel } from "../crm/funnel.ts";
import { toViews } from "../crm/leads.ts";
import { newId } from "../db.ts";
import { AppError, readJson } from "../http.ts";
import { effectiveVersion, indicatorResult, parseIndicators, versionsFor, type Indicator } from "../kpi.ts";
import { computeMetrics, emptyValues, isMetric, leadsForMetric, METRICS, NO_OWNER, ratio, type MetricFilter, type MetricValues } from "../metrics.ts";

type Scope = {
    filter: MetricFilter;
    timezone: string;
    period: { from: string; to: string };
    branchIds: string[] | "all";
    branchName: string | null;
    userName: string | null;
};

async function timezoneOf(ctx: Ctx, actor: Actor) {
    const company = await ctx.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, actor.companyId)).get();
    return company?.timezone ?? companyConfig.timezone;
}

function readPeriod(params: URLSearchParams, timezone: string, now: number): { from: LocalDate; to: LocalDate } {
    const fallback = currentMonth(timezone, now);
    const from = parseLocalDate(params.get("from") ?? "") ?? fallback.from;
    const to = parseLocalDate(params.get("to") ?? "") ?? fallback.to;
    const span = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
    if (span < 0 || span > 366 * 86_400_000) throw new AppError(400, "stats.periodInvalid");
    return { from, to };
}

/**
 * Срез данных с учётом прав: сотрудник — только свои показатели,
 * руководитель — свой филиал, директор — филиал или «Все филиалы».
 */
async function resolveScope(ctx: Ctx, actor: Actor, forEmployeeSelf: boolean): Promise<Scope> {
    const params = ctx.url.searchParams;
    // Часовой пояс и права на филиал — параллельно.
    const [timezone, branchScope] = await Promise.all([
        timezoneOf(ctx, actor),
        forEmployeeSelf ? Promise.resolve(null) : resolveBranchScope(ctx, actor, params.get("branchId"), { allowAll: true }),
    ]);
    const period = readPeriod(params, timezone, ctx.now);
    const bounds = periodBounds(timezone, period.from, period.to);
    let branchIds: string[] | "all";
    let ownerUserId: string | null = null;
    if (forEmployeeSelf) {
        if (!actor.branchId) throw new AppError(403, "auth.forbidden");
        branchIds = [actor.branchId];
        ownerUserId = actor.userId;
    } else {
        const scope = branchScope!;
        branchIds = scope.kind === "all" ? "all" : [scope.branchId];
        const userId = params.get("userId");
        if (userId) {
            const user = await ctx.db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, actor.companyId))).get();
            if (!user || (branchIds !== "all" && (!user.branchId || !branchIds.includes(user.branchId)))) throw new AppError(404, "team.userNotFound");
            ownerUserId = user.id;
        }
    }
    const [branchRow, userRow] = await Promise.all([
        branchIds === "all" ? Promise.resolve(undefined) : ctx.db.select({ name: branches.name }).from(branches).where(eq(branches.id, branchIds[0]!)).get(),
        ownerUserId ? ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, ownerUserId)).get() : Promise.resolve(undefined),
    ]);
    const branchName = branchRow?.name ?? null;
    const userName = userRow?.name ?? null;
    return {
        filter: { companyId: actor.companyId, branchIds, ownerUserId, from: bounds.from, to: bounds.to, now: ctx.now },
        timezone,
        period: { from: formatLocalDate(period.from), to: formatLocalDate(period.to) },
        branchIds,
        branchName,
        userName,
    };
}

/** Сотрудники среза: активные сотрудники и руководители филиалов + все, у кого есть значения */
async function peopleInScope(ctx: Ctx, actor: Actor, scope: Scope, extraIds: string[]) {
    const conditions = [eq(users.companyId, actor.companyId), inArray(users.role, ["employee", "manager"]), eq(users.status, "active")];
    if (scope.branchIds !== "all") conditions.push(inArray(users.branchId, scope.branchIds));
    if (scope.filter.ownerUserId) conditions.push(eq(users.id, scope.filter.ownerUserId));
    const active = await ctx.db.select({ id: users.id, name: users.displayName, branchId: users.branchId }).from(users).where(and(...conditions)).all();
    const known = new Set(active.map((row) => row.id));
    const missing = extraIds.filter((id) => id !== NO_OWNER && !known.has(id));
    // Названия филиалов компании берём одним запросом параллельно с недостающими людьми.
    const [others, branchRows] = await Promise.all([
        missing.length ? ctx.db.select({ id: users.id, name: users.displayName, branchId: users.branchId }).from(users).where(inArray(users.id, missing)).all() : Promise.resolve([]),
        ctx.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.companyId, actor.companyId)).all(),
    ]);
    const all = [...active, ...others];
    const names = new Map(branchRows.map((row) => [row.id, row.name]));
    return all.map((row) => ({ ...row, branchName: row.branchId ? (names.get(row.branchId) ?? null) : null }));
}

function derived(values: MetricValues) {
    return {
        conversion: ratio(values.leads_won, values.leads_closed, "noClosed"),
        avgCheck: ratio(values.revenue_won, values.leads_won, "noWon"),
    };
}

// --- Статистика ----------------------------------------------------------

export async function stats(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireSection(actor, "stats");
    const [scope, funnel] = await Promise.all([resolveScope(ctx, actor, false), getFunnel(ctx.db, actor.companyId)]);
    const { totals, byOwner } = await computeMetrics(ctx.db, scope.filter, funnel);
    const people = await peopleInScope(ctx, actor, scope, [...byOwner.keys()]);
    const rows = people.map((person) => {
        const values = byOwner.get(person.id) ?? emptyValues();
        return { userId: person.id, name: person.name, branchName: person.branchName, values, ...derived(values) };
    });
    const unassigned = byOwner.get(NO_OWNER);
    if (unassigned && !scope.filter.ownerUserId) rows.push({ userId: NO_OWNER, name: "", branchName: null, values: unassigned, ...derived(unassigned) });
    return {
        period: scope.period,
        timezone: scope.timezone,
        branchName: scope.branchName,
        userName: scope.userName,
        generatedAt: ctx.now,
        totals: { values: totals, ...derived(totals) },
        employees: rows,
        currency: companyConfig.currency,
    };
}

/** Сделки, из которых рассчитан показатель (тот же расчёт, что и в сводке) */
export async function statsLeads(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const metric = ctx.url.searchParams.get("metric") ?? "";
    if (!isMetric(metric)) throw new AppError(400, "stats.metricUnknown");
    const self = actor.role === "employee";
    if (self) requireSection(actor, "kpi");
    else requireSection(actor, "stats");
    const scope = await resolveScope(ctx, actor, self);
    const funnel = await getFunnel(ctx.db, actor.companyId);
    const ownerParam = ctx.url.searchParams.get("owner");
    const owner = ownerParam === null ? undefined : ownerParam === NO_OWNER ? null : ownerParam;
    const rows = await leadsForMetric(ctx.db, scope.filter, funnel, metric, owner);
    rows.sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));
    const total = rows.reduce((sum, row) => sum + (metric === "revenue_won" ? (row.amount ?? 0) : 1), 0);
    return { metric, total, period: scope.period, branchName: scope.branchName, funnel, leads: await toViews(ctx.db, rows.slice(0, 500), funnel, ctx.now), timezone: scope.timezone };
}

// --- KPI: методика -------------------------------------------------------

async function methodologyScope(ctx: Ctx, actor: Actor, requested: string | null): Promise<{ scope: string; canEdit: boolean }> {
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    // Явно указанная область — как есть; по умолчанию руководителю — его филиал, директору — общая.
    const scope = requested ?? (actor.role === "manager" ? (actor.branchId ?? "company") : "company");
    if (scope !== "company") {
        const branch = await loadCompanyBranch(ctx, actor, scope, { includeArchived: true });
        if (actor.role === "manager" && branch.id !== actor.branchId) throw new AppError(403, "auth.forbidden");
    }
    return { scope, canEdit: actor.role === "director" || scope === actor.branchId };
}

export async function methodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const { scope, canEdit } = await methodologyScope(ctx, actor, ctx.url.searchParams.get("scope"));
    const rows = await versionsFor(ctx.db, actor.companyId, [scope]);
    const authorIds = [...new Set(rows.flatMap((row) => [row.createdBy, row.approvedBy]).filter((id): id is string => Boolean(id)))];
    const authors = authorIds.length ? new Map((await ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)).all()).map((row) => [row.id, row.name])) : new Map();
    const current = await effectiveVersion(ctx.db, actor.companyId, scope === "company" ? null : scope, ctx.now);
    return {
        scope,
        canEdit,
        fields: METRICS,
        currentVersionId: current?.id ?? null,
        currentScope: current?.scope ?? null,
        versions: rows.map((row) => ({
            id: row.id,
            version: row.version,
            status: row.status,
            indicators: JSON.parse(row.indicators) as Indicator[],
            createdAt: row.createdAt,
            createdBy: authors.get(row.createdBy) ?? null,
            approvedAt: row.approvedAt,
            approvedBy: row.approvedBy ? (authors.get(row.approvedBy) ?? null) : null,
        })),
    };
}

/** Сохранение создаёт новую версию (черновик); прежние версии не меняются */
export async function saveMethodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const { scope, canEdit } = await methodologyScope(ctx, actor, typeof body["scope"] === "string" ? body["scope"] : null);
    if (!canEdit) throw new AppError(403, "auth.forbidden");
    const indicators = parseIndicators(body["indicators"]);
    const id = newId();
    await ctx.env.DB.prepare(
        `INSERT INTO kpi_versions (id, company_id, scope, version, status, indicators, created_by, created_at)
         SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, 'draft', ?, ?, ? FROM kpi_versions WHERE company_id = ? AND scope = ?`
    )
        .bind(id, actor.companyId, scope, JSON.stringify(indicators), actor.userId, ctx.now, actor.companyId, scope)
        .run();
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "kpi.save", entityType: "kpi_version", entityId: id, data: { scope } }, ctx.now);
    return { id };
}

/** Утверждённая версия применяется ко всем расчётам начиная с момента утверждения */
export async function approveMethodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const row = await ctx.db.select().from(kpiVersions).where(and(eq(kpiVersions.id, ctx.params["id"] ?? ""), eq(kpiVersions.companyId, actor.companyId))).get();
    if (!row) throw new AppError(404, "error.notFound");
    const { canEdit } = await methodologyScope(ctx, actor, row.scope);
    if (!canEdit) throw new AppError(403, "auth.forbidden");
    if (row.status !== "approved") {
        await ctx.db.update(kpiVersions).set({ status: "approved", approvedAt: ctx.now, approvedBy: actor.userId }).where(eq(kpiVersions.id, row.id));
        await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "kpi.approve", entityType: "kpi_version", entityId: row.id }, ctx.now);
    }
    return { ok: true };
}

// --- KPI: отчёт ----------------------------------------------------------

export async function kpiReport(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireSection(actor, "kpi");
    const self = actor.role === "employee";
    const [scope, funnel] = await Promise.all([resolveScope(ctx, actor, self), getFunnel(ctx.db, actor.companyId)]);
    const [{ byOwner }, peopleRows] = await Promise.all([
        computeMetrics(ctx.db, scope.filter, funnel),
        self ? Promise.resolve([{ id: actor.userId, name: actor.displayName, branchId: actor.branchId, branchName: scope.branchName }]) : peopleInScope(ctx, actor, scope, []),
    ]);
    const people = peopleRows.filter((person) => self || !scope.filter.ownerUserId || person.id === scope.filter.ownerUserId);

    // Действующие версии методики — по одной на филиал, все сразу.
    const branchKeys = [...new Set(people.map((person) => person.branchId ?? null))];
    const versions = await Promise.all(branchKeys.map((branchId) => effectiveVersion(ctx.db, actor.companyId, branchId, scope.filter.to)));
    const versionCache = new Map(branchKeys.map((branchId, index) => [branchId ?? "company", versions[index]]));
    const rows = [];
    for (const person of people) {
        const version = versionCache.get(person.branchId ?? "company") ?? null;
        const values = byOwner.get(person.id) ?? emptyValues();
        rows.push({
            userId: person.id,
            name: person.name,
            branchName: person.branchName,
            version: version ? { id: version.id, version: version.version, scope: version.scope, approvedAt: version.approvedAt } : null,
            values,
            indicators: version ? (JSON.parse(version.indicators) as Indicator[]).map((indicator) => indicatorResult(indicator, values)) : [],
        });
    }
    return {
        period: scope.period,
        timezone: scope.timezone,
        branchName: scope.branchName,
        self,
        configured: rows.some((row) => row.version !== null),
        fields: METRICS,
        currency: companyConfig.currency,
        rows,
    };
}
