/**
 * Статистика и KPI. Сначала права (филиалы, сотрудник), потом расчёт —
 * обе части вызывают computeMetrics из server/metrics.ts.
 */
import { and, eq, inArray } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { branches, companies, kpiVersions, users } from "../../db/schema.ts";
import { currentMonth, formatLocalDate, parseLocalDate, periodBounds, startOfDay, type LocalDate } from "../../lib/time.ts";
import { loadCompanyBranch, requireSection, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { getFunnel } from "../crm/funnel.ts";
import { toViews } from "../crm/leads.ts";
import { newId } from "../db.ts";
import { AppError, readJson } from "../http.ts";
import { approvedVersions, indicatorResult, parseIndicators, pickVersion, userScope, versionsFor, type Indicator } from "../kpi.ts";
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

type MethodologyTarget = { scope: string; canEdit: boolean; kind: "company" | "branch" | "user"; branchId: string | null; userId: string | null; name: string | null };

/**
 * Область методики: «company», id филиала или «user:<id>» (формула отдельного сотрудника).
 * Руководитель работает только со своим филиалом и его людьми.
 */
async function methodologyScope(ctx: Ctx, actor: Actor, requested: string | null): Promise<MethodologyTarget> {
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const scope = requested ?? (actor.role === "manager" ? (actor.branchId ?? "company") : "company");
    if (scope === "company") return { scope, canEdit: actor.role === "director", kind: "company", branchId: null, userId: null, name: null };
    if (scope.startsWith("user:")) {
        const person = await ctx.db.select().from(users).where(and(eq(users.id, scope.slice(5)), eq(users.companyId, actor.companyId))).get();
        if (!person || person.role === "director") throw new AppError(404, "team.userNotFound");
        if (actor.role === "manager" && person.branchId !== actor.branchId) throw new AppError(404, "team.userNotFound");
        return { scope, canEdit: true, kind: "user", branchId: person.branchId, userId: person.id, name: person.displayName };
    }
    const branch = await loadCompanyBranch(ctx, actor, scope, { includeArchived: true });
    if (actor.role === "manager" && branch.id !== actor.branchId) throw new AppError(403, "auth.forbidden");
    return { scope, canEdit: actor.role === "director" || scope === actor.branchId, kind: "branch", branchId: branch.id, userId: null, name: branch.name };
}

/** «ГГГГ-ММ-ДД» → полночь в часовом поясе компании; пусто — null (с момента утверждения) */
function readStartDate(value: unknown, timezone: string): number | null {
    if (value === undefined || value === null || value === "") return null;
    const date = typeof value === "string" ? parseLocalDate(value) : null;
    if (!date) throw new AppError(400, "kpi.startInvalid", { fields: { effectiveFrom: "kpi.startInvalid" } });
    return startOfDay(timezone, date);
}

export async function methodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const target = await methodologyScope(ctx, actor, ctx.url.searchParams.get("scope"));
    const rows = await versionsFor(ctx.db, actor.companyId, [target.scope]);
    const authorIds = [...new Set(rows.flatMap((row) => [row.createdBy, row.approvedBy]).filter((id): id is string => Boolean(id)))];
    const [authorRows, applicable] = await Promise.all([
        authorIds.length ? ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)).all() : Promise.resolve([]),
        approvedVersions(ctx.db, actor.companyId, [target.scope, target.branchId ?? "company", "company"]),
    ]);
    const authors = new Map(authorRows.map((row) => [row.id, row.name]));
    const current = pickVersion(applicable, { userId: target.userId, branchId: target.branchId }, ctx.now);
    return {
        scope: target.scope,
        kind: target.kind,
        name: target.name,
        canEdit: target.canEdit,
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
            effectiveFrom: row.effectiveFrom,
        })),
    };
}

/** Сохранение создаёт новую версию (черновик) с датой начала действия; прежние версии не меняются */
export async function saveMethodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const target = await methodologyScope(ctx, actor, typeof body["scope"] === "string" ? body["scope"] : null);
    if (!target.canEdit) throw new AppError(403, "auth.forbidden");
    const indicators = parseIndicators(body["indicators"]);
    const effectiveFrom = readStartDate(body["effectiveFrom"], await timezoneOf(ctx, actor));
    const id = newId();
    await ctx.env.DB.prepare(
        `INSERT INTO kpi_versions (id, company_id, scope, version, status, indicators, created_by, created_at, effective_from)
         SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, 'draft', ?, ?, ?, ? FROM kpi_versions WHERE company_id = ? AND scope = ?`
    )
        .bind(id, actor.companyId, target.scope, JSON.stringify(indicators), actor.userId, ctx.now, effectiveFrom, actor.companyId, target.scope)
        .run();
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "kpi.save", entityType: "kpi_version", entityId: id, data: { scope: target.scope, effectiveFrom } }, ctx.now);
    return { id };
}

/** Утверждённая версия применяется с даты начала действия (или с момента утверждения) */
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

/**
 * Копирование формулы на нескольких сотрудников: каждому — своя утверждённая версия
 * с той же формулой и датой начала. Руководитель — только своим сотрудникам.
 */
export async function copyMethodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const body = await readJson(ctx.request);
    const indicators = parseIndicators(body["indicators"]);
    const ids = Array.isArray(body["userIds"]) ? [...new Set(body["userIds"].filter((id): id is string => typeof id === "string"))] : [];
    if (!ids.length || ids.length > 200) throw new AppError(400, "kpi.copyNoPeople", { fields: { userIds: "kpi.copyNoPeople" } });
    const people = await ctx.db.select().from(users).where(and(inArray(users.id, ids), eq(users.companyId, actor.companyId))).all();
    const allowed = people.filter((person) => person.role !== "director" && (actor.role === "director" || person.branchId === actor.branchId));
    if (allowed.length !== ids.length) throw new AppError(404, "team.userNotFound");
    const effectiveFrom = readStartDate(body["effectiveFrom"], await timezoneOf(ctx, actor));
    const json = JSON.stringify(indicators);
    const d1 = ctx.env.DB;
    const statements = allowed.map((person) =>
        d1
            .prepare(
                `INSERT INTO kpi_versions (id, company_id, scope, version, status, indicators, created_by, created_at, approved_by, approved_at, effective_from)
                 SELECT ?1, ?2, ?3, COALESCE(MAX(version), 0) + 1, 'approved', ?4, ?5, ?6, ?5, ?6, ?7 FROM kpi_versions WHERE company_id = ?2 AND scope = ?3`
            )
            .bind(newId(), actor.companyId, userScope(person.id), json, actor.userId, ctx.now, effectiveFrom)
    );
    await d1.batch(statements);
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "kpi.copy", entityType: "kpi_version", entityId: null, data: { userIds: allowed.map((person) => person.id), effectiveFrom } }, ctx.now);
    return { copied: allowed.length };
}

/** Предпросмотр расчёта несохранённой формулы на данных текущего месяца */
export async function previewMethodology(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const target = await methodologyScope(ctx, actor, typeof body["scope"] === "string" ? body["scope"] : null);
    const indicators = parseIndicators(body["indicators"]);
    const [timezone, funnel] = await Promise.all([timezoneOf(ctx, actor), getFunnel(ctx.db, actor.companyId)]);
    const month = currentMonth(timezone, ctx.now);
    const bounds = periodBounds(timezone, month.from, month.to);
    const branchIds: string[] | "all" = target.kind === "company" ? (actor.role === "manager" && actor.branchId ? [actor.branchId] : "all") : target.branchId ? [target.branchId] : [];
    const filter = { companyId: actor.companyId, branchIds, ownerUserId: target.userId, from: bounds.from, to: bounds.to, now: ctx.now };
    const scope: Scope = { filter, timezone, period: { from: formatLocalDate(month.from), to: formatLocalDate(month.to) }, branchIds, branchName: null, userName: null };
    const [{ byOwner }, people] = await Promise.all([computeMetrics(ctx.db, filter, funnel), peopleInScope(ctx, actor, scope, [])]);
    const rows = people
        .filter((person) => !target.userId || person.id === target.userId)
        .slice(0, 30)
        .map((person) => {
            const values = byOwner.get(person.id) ?? emptyValues();
            return { userId: person.id, name: person.name, branchName: person.branchName, indicators: indicators.map((indicator) => indicatorResult(indicator, values)) };
        });
    return { period: scope.period, timezone, rows };
}

// --- KPI: отчёт и прогноз ------------------------------------------------

/** Показатели «на момент»: их не продлеваем до конца периода */
const SNAPSHOT_METRICS = new Set(["open_leads", "overdue_contacts"]);

/** Прогноз на конец периода: накопительные показатели продлеваются в текущем темпе */
function forecastValues(values: MetricValues, factor: number): MetricValues {
    const result = { ...values };
    for (const key of Object.keys(result) as Array<keyof MetricValues>) if (!SNAPSHOT_METRICS.has(key)) result[key] = values[key] * factor;
    return result;
}

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

    // Все нужные версии методики (сотрудники, филиалы, общая) — одним запросом.
    const scopes = ["company", ...people.map((person) => userScope(person.id)), ...people.map((person) => person.branchId).filter((id): id is string => Boolean(id))];
    const versions = await approvedVersions(ctx.db, actor.companyId, scopes);

    // Ход периода для прогноза: сколько дней прошло из скольких
    const DAY = 86_400_000;
    const totalDays = Math.max(1, Math.round((scope.filter.to - scope.filter.from) / DAY));
    const elapsedDays = Math.min(totalDays, Math.max(0, Math.ceil((ctx.now - scope.filter.from) / DAY)));
    const factor = ctx.now >= scope.filter.to ? 1 : elapsedDays > 0 ? totalDays / elapsedDays : null;

    const rows = [];
    // Какая версия действует для периода: прошлый период — на его конец; текущий — на сегодня
    // (версии с будущей датой начала ещё не применяются); будущий — на его первый день.
    const reference = Math.min(scope.filter.to, Math.max(ctx.now, scope.filter.from));
    for (const person of people) {
        const version = pickVersion(versions, { userId: person.id, branchId: person.branchId }, reference);
        const values = byOwner.get(person.id) ?? emptyValues();
        const projected = factor === null ? null : forecastValues(values, factor);
        rows.push({
            userId: person.id,
            name: person.name,
            branchName: person.branchName,
            version: version ? { id: version.id, version: version.version, scope: version.scope.startsWith("user:") ? "user" : version.scope === "company" ? "company" : "branch", approvedAt: version.approvedAt, effectiveFrom: version.effectiveFrom } : null,
            values,
            indicators: version
                ? (JSON.parse(version.indicators) as Indicator[]).map((indicator) => {
                      const result = indicatorResult(indicator, values);
                      const forecast = projected ? indicatorResult(indicator, projected) : null;
                      return { ...result, forecast: forecast?.fact ?? null, forecastPercent: forecast?.percent ?? null };
                  })
                : [],
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
        progress: { elapsedDays, totalDays, complete: ctx.now >= scope.filter.to, started: factor !== null },
        rows,
    };
}
