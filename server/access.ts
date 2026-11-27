import { and, eq, isNull } from "drizzle-orm";
import { branches } from "../db/schema.ts";
import type { Actor } from "./auth.ts";
import type { Ctx } from "./context.ts";
import { AppError } from "./http.ts";

/**
 * Матрица доступа к разделам. Единственный источник правды и для сервера,
 * и для навигации (клиент получает результат через /api/me).
 */
export const SECTIONS = ["training", "crm", "kpi", "stats", "whatsapp", "settings", "profile"] as const;
export type Section = (typeof SECTIONS)[number];

export function canUseSection(actor: Actor, section: Section): boolean {
    // Рабочая роль сужает доступ к рабочим разделам (кроме директора).
    if (actor.role !== "director" && actor.workSections && (section === "crm" || section === "kpi" || section === "stats") && !actor.workSections.includes(section)) return false;
    switch (section) {
        case "training":
        case "profile":
            return true;
        case "crm":
        case "kpi":
            // Сотрудник — только после допуска; руководитель и директор — всегда.
            return actor.admitted;
        case "whatsapp":
            // Ключи подключений вводятся в студии — только директор.
            return actor.role === "director";
        case "stats":
        case "settings":
            // Руководитель видит в настройках только участников и приглашения своего филиала.
            return actor.role === "director" || actor.role === "manager";
    }
}

export function requireSection(actor: Actor, section: Section): void {
    if (!canUseSection(actor, section)) throw new AppError(403, "shell.sectionLocked");
}

export function sectionMap(actor: Actor): Record<Section, boolean> {
    return Object.fromEntries(SECTIONS.map((section) => [section, canUseSection(actor, section)])) as Record<Section, boolean>;
}

export type BranchScope =
    /** Один конкретный филиал */
    | { kind: "one"; branchId: string }
    /** Все филиалы компании (только директор и только там, где разрешено) */
    | { kind: "all"; companyId: string };

/** Проверяет, что филиал принадлежит компании пользователя */
export async function loadCompanyBranch(ctx: Ctx, actor: Actor, branchId: string, options: { includeArchived?: boolean } = {}) {
    const conditions = [eq(branches.id, branchId), eq(branches.companyId, actor.companyId)];
    if (!options.includeArchived) conditions.push(isNull(branches.archivedAt));
    const branch = await ctx.db.select().from(branches).where(and(...conditions)).get();
    if (!branch) throw new AppError(404, "branches.notFound");
    return branch;
}

/**
 * Сначала права, потом данные: определяет, какие филиалы видит пользователь.
 * - сотрудник и руководитель: только свой филиал, чужой запрошенный → 403;
 * - директор: запрошенный филиал, иначе выбранный в шапке; «Все» — только при allowAll.
 */
export async function resolveBranchScope(
    ctx: Ctx,
    actor: Actor,
    requested: string | null | undefined,
    options: { allowAll: boolean }
): Promise<BranchScope> {
    if (actor.role !== "director") {
        if (!actor.branchId) throw new AppError(403, "auth.forbidden");
        if (requested && requested !== "*" && requested !== actor.branchId) throw new AppError(403, "auth.forbidden");
        return { kind: "one", branchId: actor.branchId };
    }
    const wanted = requested ?? actor.selectedBranchId ?? (await singleBranchId(ctx, actor.companyId)) ?? "*";
    if (wanted === "*") {
        if (!options.allowAll) throw new AppError(400, "shell.selectBranchForCrm");
        return { kind: "all", companyId: actor.companyId };
    }
    const branch = await loadCompanyBranch(ctx, actor, wanted, { includeArchived: true });
    return { kind: "one", branchId: branch.id };
}

/** Если у компании ровно один действующий филиал — он выбирается автоматически */
export async function singleBranchId(ctx: Ctx, companyId: string): Promise<string | null> {
    const rows = await ctx.db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.companyId, companyId), isNull(branches.archivedAt)))
        .limit(2)
        .all();
    return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}

/** Может ли пользователь управлять сотрудником (руководитель — только своим филиалом) */
export function canManageUser(actor: Actor, target: { companyId: string; branchId: string | null; role: string; id: string }): boolean {
    if (target.companyId !== actor.companyId) return false;
    if (target.id === actor.userId) return false;
    if (actor.role === "director") return true;
    if (actor.role === "manager") return target.role === "employee" && target.branchId === actor.branchId && actor.branchId !== null;
    return false;
}
