import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { admissions, branches, companies, passwordResetCodes, users, type Role } from "../../db/schema.ts";
import { canManageUser, loadCompanyBranch, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, requireRole, revokeAllSessions, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { randomCode, sha256Hex } from "../crypto.ts";
import { isUniqueViolation, newId } from "../db.ts";
import { AppError, badRequest, bool, optStr, readJson, str } from "../http.ts";
import { isValidTimezone } from "../validation.ts";

// --- Компания ---

export async function getCompany(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const company = await ctx.db.select().from(companies).where(eq(companies.id, actor.companyId)).get();
    if (!company) throw new AppError(404, "error.notFound");
    return { company: { id: company.id, name: company.name, timezone: company.timezone } };
}

export async function updateCompany(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const body = await readJson(ctx.request);
    const name = str(body, "name", { max: 120 });
    if (name.length < 2) throw badRequest("validation.invalidInput", { name: "validation.nameLength" });
    const timezone = str(body, "timezone", { max: 64 });
    if (!isValidTimezone(timezone)) throw badRequest("settings.invalidTimezone", { timezone: "settings.invalidTimezone" });
    await ctx.db.update(companies).set({ name, timezone, updatedAt: ctx.now }).where(eq(companies.id, actor.companyId));
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "company.update", entityType: "company", entityId: actor.companyId, data: { name, timezone } }, ctx.now);
    return { ok: true };
}

// --- Филиалы ---

export async function listBranches(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const conditions = [eq(branches.companyId, actor.companyId)];
    if (actor.role !== "director") {
        if (!actor.branchId) return { branches: [] };
        conditions.push(eq(branches.id, actor.branchId));
    }
    const rows = await ctx.db.select().from(branches).where(and(...conditions)).orderBy(branches.name).all();
    const counts = await ctx.db
        .select({ branchId: users.branchId, total: count() })
        .from(users)
        .where(and(eq(users.companyId, actor.companyId), eq(users.status, "active")))
        .groupBy(users.branchId)
        .all();
    const byBranch = new Map(counts.map((row) => [row.branchId, row.total]));
    return {
        branches: rows.map((row) => ({
            id: row.id,
            name: row.name,
            city: row.city,
            archived: row.archivedAt !== null,
            createdAt: row.createdAt,
            employees: byBranch.get(row.id) ?? 0,
        })),
    };
}

function readBranchName(body: Record<string, unknown>): string {
    const name = str(body, "name", { max: 200 }).replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) throw badRequest("validation.invalidInput", { name: "validation.branchNameLength" });
    return name;
}

export async function createBranch(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const body = await readJson(ctx.request);
    const name = readBranchName(body);
    const city = optStr(body, "city", 80);
    const id = newId();
    try {
        await ctx.db.insert(branches).values({ id, companyId: actor.companyId, name, city, createdAt: ctx.now, createdBy: actor.userId });
    } catch (error) {
        if (isUniqueViolation(error)) throw badRequest("validation.branchNameTaken", { name: "validation.branchNameTaken" });
        throw error;
    }
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "branch.create", entityType: "branch", entityId: id, data: { name } }, ctx.now);
    return { branch: { id, name, city } };
}

export async function updateBranch(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const branch = await loadCompanyBranch(ctx, actor, ctx.params["id"] ?? "", { includeArchived: true });
    const body = await readJson(ctx.request);
    const updates: Partial<typeof branches.$inferInsert> = {};
    if ("name" in body) updates.name = readBranchName(body);
    if ("city" in body) updates.city = optStr(body, "city", 80);
    if ("archived" in body) updates.archivedAt = bool(body, "archived") ? (branch.archivedAt ?? ctx.now) : null;
    try {
        await ctx.db.update(branches).set(updates).where(eq(branches.id, branch.id));
    } catch (error) {
        if (isUniqueViolation(error)) throw badRequest("validation.branchNameTaken", { name: "validation.branchNameTaken" });
        throw error;
    }
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "branch.update", entityType: "branch", entityId: branch.id, data: updates }, ctx.now);
    return { ok: true };
}

// --- Сотрудники ---

export async function listUsers(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const scope = await resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true });
    const conditions = [eq(users.companyId, actor.companyId)];
    if (scope.kind === "one") conditions.push(eq(users.branchId, scope.branchId));
    const rows = await ctx.db
        .select({
            id: users.id,
            login: users.login,
            displayName: users.displayName,
            role: users.role,
            branchId: users.branchId,
            branchName: branches.name,
            status: users.status,
            createdAt: users.createdAt,
            lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.branchId))
        .where(and(...conditions))
        .orderBy(users.displayName)
        .all();
    const ids = rows.map((row) => row.id);
    const admitted = ids.length
        ? await ctx.db
              .select({ userId: admissions.userId, source: admissions.source, grantedAt: admissions.grantedAt })
              .from(admissions)
              .where(and(inArray(admissions.userId, ids), isNull(admissions.revokedAt)))
              .all()
        : [];
    const admittedMap = new Map(admitted.map((row) => [row.userId, row]));
    return {
        users: rows.map((row) => {
            const admission = admittedMap.get(row.id);
            return {
                ...row,
                admitted: row.role !== "employee" || Boolean(admission),
                admission: admission ? { source: admission.source, grantedAt: admission.grantedAt } : null,
                canManage: canManageUser(actor, { ...row, companyId: actor.companyId }),
                isSelf: row.id === actor.userId,
            };
        }),
    };
}

async function loadManagedUser(ctx: Ctx, actor: Actor) {
    const target = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.id, ctx.params["id"] ?? ""), eq(users.companyId, actor.companyId)))
        .get();
    if (!target) throw new AppError(404, "team.userNotFound");
    if (target.id === actor.userId) throw new AppError(403, "team.cannotEditSelf");
    // Чужой филиал для руководителя выглядит как «не найдено», чтобы не раскрывать данные.
    if (!canManageUser(actor, target)) throw new AppError(actor.role === "manager" ? 404 : 403, actor.role === "manager" ? "team.userNotFound" : "auth.forbidden");
    return target;
}

async function assertNotLastDirector(ctx: Ctx, target: typeof users.$inferSelect) {
    if (target.role !== "director" || target.status !== "active") return;
    const others = await ctx.db
        .select({ total: count() })
        .from(users)
        .where(and(eq(users.companyId, target.companyId), eq(users.role, "director"), eq(users.status, "active"), ne(users.id, target.id)))
        .get();
    if ((others?.total ?? 0) === 0) throw new AppError(409, "team.lastDirector");
}

/**
 * Изменение роли, филиала и статуса. Права пересчитываются на следующем же
 * запросе сотрудника (сессия читает пользователя из БД каждый раз).
 */
export async function updateUser(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const target = await loadManagedUser(ctx, actor);
    const body = await readJson(ctx.request);
    const updates: Partial<typeof users.$inferInsert> = {};

    if ("role" in body || "branchId" in body) {
        requireRole(actor, "director");
        const role = ("role" in body ? str(body, "role", { max: 20 }) : target.role) as Role;
        if (!["director", "manager", "employee"].includes(role)) throw badRequest("validation.invalidInput", { role: "validation.invalidInput" });
        let branchId: string | null = null;
        if (role !== "director") {
            const requested = "branchId" in body ? optStr(body, "branchId", 64) : target.branchId;
            if (!requested) throw badRequest("validation.branchRequired", { branchId: "validation.branchRequired" });
            branchId = (await loadCompanyBranch(ctx, actor, requested)).id;
        }
        if (role !== "director") await assertNotLastDirector(ctx, target);
        updates.role = role;
        updates.branchId = branchId;
    }
    if ("status" in body) {
        const status = str(body, "status", { max: 20 });
        if (status !== "active" && status !== "disabled") throw badRequest("validation.invalidInput", { status: "validation.invalidInput" });
        if (status === "disabled") await assertNotLastDirector(ctx, target);
        updates.status = status;
    }
    if (Object.keys(updates).length === 0) return { ok: true };
    updates.updatedAt = ctx.now;
    await ctx.db.update(users).set(updates).where(eq(users.id, target.id));
    if (updates.status === "disabled") await revokeAllSessions(ctx, target.id);
    // Перевод в другой филиал снимает допуск: он выдавался по правилам прежнего филиала.
    if (updates.branchId !== undefined && updates.branchId !== target.branchId && target.role === "employee") {
        await ctx.db
            .update(admissions)
            .set({ revokedAt: ctx.now, revokedBy: actor.userId, reason: "branch-transfer" })
            .where(and(eq(admissions.userId, target.id), isNull(admissions.revokedAt)));
    }
    await audit(
        ctx.db,
        {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: "user.update",
            entityType: "user",
            entityId: target.id,
            data: { before: { role: target.role, branchId: target.branchId, status: target.status }, after: updates },
        },
        ctx.now
    );
    return { ok: true };
}

export async function issueResetCode(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const target = await loadManagedUser(ctx, actor);
    const code = randomCode(10);
    // Прежние неиспользованные коды гасим: действует только последний.
    await ctx.db
        .update(passwordResetCodes)
        .set({ usedAt: ctx.now })
        .where(and(eq(passwordResetCodes.userId, target.id), isNull(passwordResetCodes.usedAt)));
    const expiresAt = ctx.now + companyConfig.resetCodeTtlHours * 60 * 60_000;
    await ctx.db.insert(passwordResetCodes).values({
        id: newId(),
        userId: target.id,
        codeHash: await sha256Hex(code),
        createdBy: actor.userId,
        createdAt: ctx.now,
        expiresAt,
    });
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "password.resetCode", entityType: "user", entityId: target.id }, ctx.now);
    return { code, expiresAt, login: target.login, displayName: target.displayName };
}

/** Ручная выдача или снятие допуска (вдобавок к автоматическому допуску по тесту) */
export async function setAdmission(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const target = await loadManagedUser(ctx, actor);
    if (target.role !== "employee") throw badRequest("validation.invalidInput");
    const body = await readJson(ctx.request);
    const grant = bool(body, "admitted");
    const reason = optStr(body, "reason", 300);
    const active = await ctx.db
        .select()
        .from(admissions)
        .where(and(eq(admissions.userId, target.id), isNull(admissions.revokedAt)))
        .orderBy(desc(admissions.grantedAt))
        .all();
    if (grant && active.length === 0) {
        await ctx.db.insert(admissions).values({
            id: newId(),
            companyId: actor.companyId,
            userId: target.id,
            source: "manual",
            grantedBy: actor.userId,
            grantedAt: ctx.now,
            reason,
        });
    }
    if (!grant && active.length > 0) {
        await ctx.db
            .update(admissions)
            .set({ revokedAt: ctx.now, revokedBy: actor.userId, reason })
            .where(and(eq(admissions.userId, target.id), isNull(admissions.revokedAt)));
    }
    await audit(
        ctx.db,
        { companyId: actor.companyId, actorUserId: actor.userId, action: grant ? "admission.grant" : "admission.revoke", entityType: "user", entityId: target.id, data: { reason } },
        ctx.now
    );
    return { ok: true, admitted: grant };
}
