/**
 * Единая функция расчёта показателей по данным CRM.
 * Её вызывают и KPI, и статистика, и переход к исходным сделкам —
 * поэтому при одинаковых фильтрах числа совпадают.
 *
 * Отнесение к сотруднику:
 * - новые лиды, открытые, просроченные — текущий ответственный (на момент среза);
 * - сделки, отказы, выручка — ответственный на момент закрытия.
 */
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { FunnelConfig } from "../config/company.ts";
import { leads } from "../db/schema.ts";
import type { Db } from "./db.ts";
import type { LeadRow } from "./crm/leads.ts";

export const METRICS = ["leads_created", "leads_won", "leads_lost", "leads_closed", "revenue_won", "open_leads", "overdue_contacts"] as const;
export type Metric = (typeof METRICS)[number];
export type MetricValues = Record<Metric, number>;

export type MetricFilter = {
    companyId: string;
    /** Филиалы, к которым уже применены права пользователя; "all" — все филиалы компании */
    branchIds: string[] | "all";
    /** Только этот сотрудник (по правилу отнесения); null — все */
    ownerUserId: string | null;
    from: number;
    to: number;
    now: number;
};

export const NO_OWNER = "none";

export function emptyValues(): MetricValues {
    return Object.fromEntries(METRICS.map((metric) => [metric, 0])) as MetricValues;
}

function terminalOf(funnel: FunnelConfig) {
    const won = new Set(funnel.stages.filter((stage) => stage.terminal === "won").map((stage) => stage.key));
    const lost = new Set(funnel.stages.filter((stage) => stage.terminal === "lost").map((stage) => stage.key));
    return { won, lost };
}

/** Вклад лида в показатель: попадает ли, к кому относится, какое значение */
export function contribution(lead: LeadRow, metric: Metric, funnel: FunnelConfig, filter: Pick<MetricFilter, "from" | "to" | "now">): { owner: string | null; value: number } | null {
    const { won, lost } = terminalOf(funnel);
    const closedInPeriod = lead.closedAt !== null && lead.closedAt >= filter.from && lead.closedAt < filter.to;
    const isOpen = !won.has(lead.stage) && !lost.has(lead.stage);
    switch (metric) {
        case "leads_created":
            return lead.createdAt >= filter.from && lead.createdAt < filter.to ? { owner: lead.ownerUserId, value: 1 } : null;
        case "leads_won":
            return closedInPeriod && won.has(lead.stage) ? { owner: lead.closedOwnerUserId, value: 1 } : null;
        case "leads_lost":
            return closedInPeriod && lost.has(lead.stage) ? { owner: lead.closedOwnerUserId, value: 1 } : null;
        case "leads_closed":
            return closedInPeriod && (won.has(lead.stage) || lost.has(lead.stage)) ? { owner: lead.closedOwnerUserId, value: 1 } : null;
        case "revenue_won":
            return closedInPeriod && won.has(lead.stage) ? { owner: lead.closedOwnerUserId, value: lead.amount ?? 0 } : null;
        case "open_leads":
            return isOpen && lead.createdAt < filter.to ? { owner: lead.ownerUserId, value: 1 } : null;
        case "overdue_contacts":
            return isOpen && lead.nextContactAt !== null && lead.nextContactAt < filter.now ? { owner: lead.ownerUserId, value: 1 } : null;
    }
}

/** Лиды, которые могут попасть хотя бы в один показатель периода */
async function candidateLeads(db: Db, filter: MetricFilter, funnel: FunnelConfig): Promise<LeadRow[]> {
    if (filter.branchIds !== "all" && filter.branchIds.length === 0) return [];
    const { won, lost } = terminalOf(funnel);
    const terminal = [...won, ...lost];
    const conditions = [eq(leads.companyId, filter.companyId)];
    if (filter.branchIds !== "all") conditions.push(inArray(leads.branchId, filter.branchIds));
    const open = terminal.length ? sql`${leads.stage} NOT IN (${sql.join(terminal.map((key) => sql`${key}`), sql`, `)})` : sql`1 = 1`;
    conditions.push(or(and(gte(leads.createdAt, filter.from), lt(leads.createdAt, filter.to)), and(gte(leads.closedAt, filter.from), lt(leads.closedAt, filter.to)), open)!);
    return db.select().from(leads).where(and(...conditions)).all();
}

const ownerKey = (owner: string | null) => owner ?? NO_OWNER;

/** Показатели: итог и по сотрудникам */
export async function computeMetrics(db: Db, filter: MetricFilter, funnel: FunnelConfig) {
    const rows = await candidateLeads(db, filter, funnel);
    const totals = emptyValues();
    const byOwner = new Map<string, MetricValues>();
    for (const lead of rows) {
        for (const metric of METRICS) {
            const part = contribution(lead, metric, funnel, filter);
            if (!part) continue;
            if (filter.ownerUserId !== null && part.owner !== filter.ownerUserId) continue;
            totals[metric] += part.value;
            const key = ownerKey(part.owner);
            if (!byOwner.has(key)) byOwner.set(key, emptyValues());
            byOwner.get(key)![metric] += part.value;
        }
    }
    return { totals, byOwner };
}

/** Исходные сделки показателя — те же условия, что и в расчёте */
export async function leadsForMetric(db: Db, filter: MetricFilter, funnel: FunnelConfig, metric: Metric, owner: string | null | undefined): Promise<LeadRow[]> {
    const rows = await candidateLeads(db, filter, funnel);
    return rows.filter((lead) => {
        const part = contribution(lead, metric, funnel, filter);
        if (!part) return false;
        if (filter.ownerUserId !== null && part.owner !== filter.ownerUserId) return false;
        if (owner === undefined) return true;
        return ownerKey(part.owner) === ownerKey(owner);
    });
}

/** Доля с пустым знаменателем → null и причина (на экране «—») */
export function ratio(numerator: number, denominator: number, reason: string): { value: number | null; reason: string | null } {
    return denominator === 0 ? { value: null, reason } : { value: numerator / denominator, reason: null };
}

export function isMetric(value: string): value is Metric {
    return (METRICS as readonly string[]).includes(value);
}
