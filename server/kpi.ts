/**
 * KPI: показатели с формулами из полей CRM, версии методики, расчёт отчёта.
 * Формула — последовательность блоков: поле, число, операция (+ − × ÷), скобка.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { kpiVersions } from "../db/schema.ts";
import type { Db } from "./db.ts";
import { AppError } from "./http.ts";
import { isMetric, type Metric, type MetricValues } from "./metrics.ts";

export type Token = { t: "field"; v: Metric } | { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "paren"; v: "(" | ")" };
export type Indicator = { key: string; title: string; unit: "count" | "money" | "percent"; plan: number | null; formula: Token[] };

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

export class FormulaError extends Error {}

/** Проверка и перевод в обратную польскую запись (сортировочная станция) */
export function toRpn(tokens: Token[]): Token[] {
    if (tokens.length === 0) throw new FormulaError("empty");
    const output: Token[] = [];
    const stack: Token[] = [];
    let expectOperand = true;
    for (const token of tokens) {
        if (token.t === "field" || token.t === "num") {
            if (!expectOperand) throw new FormulaError("operator expected");
            output.push(token);
            expectOperand = false;
        } else if (token.t === "op") {
            if (expectOperand) throw new FormulaError("operand expected");
            while (stack.length) {
                const top = stack[stack.length - 1]!;
                if (top.t === "op" && PRECEDENCE[top.v]! >= PRECEDENCE[token.v]!) output.push(stack.pop()!);
                else break;
            }
            stack.push(token);
            expectOperand = true;
        } else if (token.v === "(") {
            if (!expectOperand) throw new FormulaError("operator expected");
            stack.push(token);
        } else {
            if (expectOperand) throw new FormulaError("operand expected");
            let found = false;
            while (stack.length) {
                const top = stack.pop()!;
                if (top.t === "paren") {
                    found = true;
                    break;
                }
                output.push(top);
            }
            if (!found) throw new FormulaError("unbalanced");
        }
    }
    if (expectOperand) throw new FormulaError("operand expected");
    while (stack.length) {
        const top = stack.pop()!;
        if (top.t === "paren") throw new FormulaError("unbalanced");
        output.push(top);
    }
    return output;
}

/** Значение формулы; деление на ноль — null с причиной */
export function evaluate(tokens: Token[], values: MetricValues): { value: number | null; reason: "divByZero" | null } {
    const stack: number[] = [];
    for (const token of toRpn(tokens)) {
        if (token.t === "num") stack.push(token.v);
        else if (token.t === "field") stack.push(values[token.v]);
        else if (token.t === "op") {
            const right = stack.pop()!;
            const left = stack.pop()!;
            if (token.v === "/" && right === 0) return { value: null, reason: "divByZero" };
            stack.push(token.v === "+" ? left + right : token.v === "-" ? left - right : token.v === "*" ? left * right : left / right);
        }
    }
    return { value: stack[0] ?? null, reason: null };
}

/** Поля, на которых построена формула (для перехода к исходным сделкам) */
export function fieldsOf(tokens: Token[]): Metric[] {
    return [...new Set(tokens.flatMap((token) => (token.t === "field" ? [token.v] : [])))];
}

const KEY = /^[a-z][a-z0-9_]{0,31}$/;

export function parseIndicators(input: unknown): Indicator[] {
    const bad = (detail: string) => new AppError(400, "kpi.invalid", { extra: { detail } });
    if (!Array.isArray(input) || input.length === 0 || input.length > 20) throw bad("indicators");
    const keys = new Set<string>();
    return input.map((raw, index) => {
        if (typeof raw !== "object" || raw === null) throw bad(`#${index + 1}`);
        const item = raw as Record<string, unknown>;
        const key = String(item["key"] ?? "");
        if (!KEY.test(key) || keys.has(key)) throw bad(`key ${key}`);
        keys.add(key);
        const title = String(item["title"] ?? "").trim();
        if (title.length < 1 || title.length > 80) throw new AppError(400, "kpi.titleRequired", { vars: { index: index + 1 } });
        const unit = item["unit"];
        if (unit !== "count" && unit !== "money" && unit !== "percent") throw bad(`unit ${key}`);
        const planRaw = item["plan"];
        const plan = planRaw === null || planRaw === undefined || planRaw === "" ? null : Number(planRaw);
        if (plan !== null && (!Number.isFinite(plan) || plan < 0 || plan > 1e12)) throw new AppError(400, "kpi.planInvalid", { vars: { title } });
        if (!Array.isArray(item["formula"]) || item["formula"].length > 60) throw bad(`formula ${key}`);
        const formula: Token[] = item["formula"].map((tokenRaw) => {
            const token = tokenRaw as Record<string, unknown>;
            if (token["t"] === "field" && typeof token["v"] === "string" && isMetric(token["v"])) return { t: "field", v: token["v"] };
            if (token["t"] === "num" && typeof token["v"] === "number" && Number.isFinite(token["v"])) return { t: "num", v: token["v"] };
            if (token["t"] === "op" && ["+", "-", "*", "/"].includes(String(token["v"]))) return { t: "op", v: token["v"] as "+" };
            if (token["t"] === "paren" && (token["v"] === "(" || token["v"] === ")")) return { t: "paren", v: token["v"] };
            throw bad(`token ${key}`);
        });
        try {
            toRpn(formula);
        } catch {
            throw new AppError(400, "kpi.formulaInvalid", { vars: { title } });
        }
        return { key, title, unit, plan, formula };
    });
}

export type KpiVersionRow = typeof kpiVersions.$inferSelect;

/** Область методики сотрудника: отдельная формула для конкретного человека */
export const userScope = (userId: string) => `user:${userId}`;

/** С какого момента версия действует: дата начала действия, иначе момент утверждения */
export function versionStart(row: Pick<KpiVersionRow, "effectiveFrom" | "approvedAt">): number | null {
    return row.effectiveFrom ?? row.approvedAt;
}

/** Все утверждённые версии нужных областей — одним запросом */
export async function approvedVersions(db: Db, companyId: string, scopes: string[]): Promise<KpiVersionRow[]> {
    if (!scopes.length) return [];
    return db
        .select()
        .from(kpiVersions)
        .where(and(eq(kpiVersions.companyId, companyId), inArray(kpiVersions.scope, [...new Set(scopes)]), eq(kpiVersions.status, "approved"), isNotNull(kpiVersions.approvedAt)))
        .all();
}

/**
 * Действующая версия на конец периода. Порядок: формула сотрудника → методика
 * филиала → общая. Внутри области — версия с самой поздней датой начала, не позже конца периода.
 */
export function pickVersion(rows: KpiVersionRow[], target: { userId?: string | null; branchId: string | null }, periodEnd: number): KpiVersionRow | null {
    const scopes = [target.userId ? userScope(target.userId) : null, target.branchId, "company"].filter((scope): scope is string => Boolean(scope));
    for (const scope of scopes) {
        let best: KpiVersionRow | null = null;
        for (const row of rows) {
            const start = versionStart(row);
            if (row.scope !== scope || start === null || start > periodEnd) continue;
            const bestStart = best ? versionStart(best)! : -Infinity;
            if (!best || start > bestStart || (start === bestStart && row.version > best.version)) best = row;
        }
        if (best) return best;
    }
    return null;
}

/** Действующая версия на конец периода для сотрудника (или филиала, или компании) */
export async function effectiveVersion(db: Db, companyId: string, branchId: string | null, periodEnd: number, userId: string | null = null): Promise<KpiVersionRow | null> {
    const scopes = [userId ? userScope(userId) : null, branchId, "company"].filter((scope): scope is string => Boolean(scope));
    return pickVersion(await approvedVersions(db, companyId, scopes), { userId, branchId }, periodEnd);
}

export async function versionsFor(db: Db, companyId: string, scopes: string[]) {
    if (!scopes.length) return [];
    return db.select().from(kpiVersions).where(and(eq(kpiVersions.companyId, companyId), inArray(kpiVersions.scope, scopes))).orderBy(desc(kpiVersions.version)).all();
}

/** Значение показателя: факт, план, процент выполнения */
export function indicatorResult(indicator: Indicator, values: MetricValues) {
    const { value, reason } = evaluate(indicator.formula, values);
    const percent = value !== null && indicator.plan ? Math.round((value / indicator.plan) * 100) : null;
    return { key: indicator.key, title: indicator.title, unit: indicator.unit, plan: indicator.plan, fact: value, reason, percent, fields: fieldsOf(indicator.formula) };
}
