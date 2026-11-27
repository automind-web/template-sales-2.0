import { and, desc, eq, isNull } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { branches, companies, invitations, passwordResetCodes, users, type Role } from "../../db/schema.ts";
import { loadCompanyBranch, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { createSession, requireActor, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { hashPassword, randomCode, randomToken, sha256Hex, timingSafeEqual } from "../crypto.ts";
import { isUniqueViolation, newId } from "../db.ts";
import { AppError, badRequest, clientIp, optStr, readJson, str } from "../http.ts";
import { enforceRateLimit } from "../rate-limit.ts";
import { getSecret } from "../runtime.ts";
import { readDisplayName, readLogin, readNewPassword } from "../validation.ts";

type InvitationRow = typeof invitations.$inferSelect;
export type InvitationStatus = "active" | "used" | "expired" | "revoked";

export function invitationStatus(row: Pick<InvitationRow, "usedAt" | "revokedAt" | "expiresAt">, now: number): InvitationStatus {
    if (row.usedAt !== null) return "used";
    if (row.revokedAt !== null) return "revoked";
    if (row.expiresAt <= now) return "expired";
    return "active";
}

const HOUR_MS = 60 * 60_000;
const MAX_TTL_HOURS = 168;

/** Срок действия ссылки в часах: 1–168, по умолчанию из config/company.ts */
function readTtlHours(body: Record<string, unknown>, fallback: number): number {
    const raw = body["ttlHours"];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_TTL_HOURS) {
        throw badRequest("validation.ttlRange", { ttlHours: "validation.ttlRange" });
    }
    return value;
}

async function issueInvitation(
    ctx: Ctx,
    params: { kind: "activation" | "invite"; companyId: string; branchId: string | null; role: Role; note: string | null; createdBy: string | null; ttlHours: number }
) {
    const token = randomToken();
    const id = newId();
    const expiresAt = ctx.now + params.ttlHours * HOUR_MS;
    await ctx.db.insert(invitations).values({
        id,
        kind: params.kind,
        companyId: params.companyId,
        branchId: params.branchId,
        role: params.role,
        tokenHash: await sha256Hex(token),
        note: params.note,
        createdBy: params.createdBy,
        createdAt: ctx.now,
        expiresAt,
    });
    await audit(
        ctx.db,
        {
            companyId: params.companyId,
            actorUserId: params.createdBy,
            action: params.kind === "activation" ? "activation.issue" : "invitation.create",
            entityType: "invitation",
            entityId: id,
            data: { role: params.role, branchId: params.branchId },
        },
        ctx.now
    );
    const prefix = params.kind === "activation" ? "/activate/" : "/invite/";
    return { id, path: `${prefix}${token}`, expiresAt };
}

// --- Владелец: ссылка активации первого директора ---

async function directorExists(ctx: Ctx, companyId: string): Promise<boolean> {
    const row = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, "director"))).limit(1).get();
    return Boolean(row);
}

async function checkOwnerCode(ctx: Ctx, body: Record<string, unknown>) {
    const ip = clientIp(ctx.request);
    await enforceRateLimit(ctx.env.DB, `owner:${ip}`, 5, 15 * 60_000, ctx.now);
    const code = str(body, "code", { max: 500 });
    const secret = getSecret(ctx.env, "OWNER_ACTIVATION_CODE");
    if (!secret) throw new AppError(503, "owner.notConfigured");
    if (!timingSafeEqual(await sha256Hex(code), await sha256Hex(secret))) {
        throw new AppError(403, "owner.invalidCode", { fields: { code: "owner.invalidCode" } });
    }
}

/**
 * Владелец восстанавливает доступ директора, если тот потерял пароль (новая активация
 * после первой запрещена): выпускается код сброса для указанного логина директора.
 */
export async function ownerDirectorReset(ctx: Ctx) {
    const body = await readJson(ctx.request);
    await checkOwnerCode(ctx, body);
    const login = str(body, "login", { max: 64 }).toLowerCase();
    const director = await ctx.db.select().from(users).where(and(eq(users.login, login), eq(users.role, "director"))).get();
    if (!director || director.status !== "active") throw new AppError(404, "owner.directorNotFound", { fields: { login: "owner.directorNotFound" } });
    const code = randomCode(10);
    await ctx.db.update(passwordResetCodes).set({ usedAt: ctx.now }).where(and(eq(passwordResetCodes.userId, director.id), isNull(passwordResetCodes.usedAt)));
    const expiresAt = ctx.now + companyConfig.resetCodeTtlHours * 60 * 60_000;
    await ctx.db.insert(passwordResetCodes).values({ id: newId(), userId: director.id, codeHash: await sha256Hex(code), createdBy: "owner", createdAt: ctx.now, expiresAt });
    await audit(ctx.db, { companyId: director.companyId, actorUserId: null, action: "owner.directorReset", entityType: "user", entityId: director.id }, ctx.now);
    return { code, expiresAt, login: director.login };
}

/** Состояние первичной активации (без секретов): чтобы страница владельца показала нужную форму */
export async function ownerStatus(ctx: Ctx) {
    const company = await ctx.db.select().from(companies).orderBy(companies.createdAt).limit(1).get();
    return { activated: Boolean(company && (await directorExists(ctx, company.id))) };
}

export async function ownerIssueActivation(ctx: Ctx) {
    const body = await readJson(ctx.request);
    await checkOwnerCode(ctx, body);
    const note = optStr(body, "note", 200);
    const ttlHours = readTtlHours(body, companyConfig.activationLinkTtlHours);
    let company = await ctx.db.select().from(companies).orderBy(companies.createdAt).limit(1).get();
    // Первичная активация — только один раз: когда директор уже зарегистрирован, новые ссылки не выпускаются.
    if (company && (await directorExists(ctx, company.id))) throw new AppError(409, "owner.alreadyActivated");
    if (!company) {
        const name = optStr(body, "companyName", 120) ?? companyConfig.name;
        const id = newId();
        await ctx.db.insert(companies).values({
            id,
            name,
            timezone: companyConfig.timezone,
            locale: companyConfig.locale,
            createdAt: ctx.now,
            updatedAt: ctx.now,
        });
        company = await ctx.db.select().from(companies).where(eq(companies.id, id)).get();
        if (!company) throw new AppError(500, "error.internal");
    }
    // Действует только последняя ссылка: прежние неиспользованные гасим.
    await ctx.db
        .update(invitations)
        .set({ revokedAt: ctx.now })
        .where(and(eq(invitations.companyId, company.id), eq(invitations.kind, "activation"), isNull(invitations.usedAt), isNull(invitations.revokedAt)));
    const issued = await issueInvitation(ctx, {
        kind: "activation",
        companyId: company.id,
        branchId: null,
        role: "director",
        note,
        createdBy: null,
        ttlHours,
    });
    return { path: issued.path, expiresAt: issued.expiresAt, companyName: company.name };
}

// --- Публичная часть: просмотр и принятие приглашения ---

async function findByToken(ctx: Ctx, token: string) {
    if (!token || token.length > 100) return undefined;
    return ctx.db.select().from(invitations).where(eq(invitations.tokenHash, await sha256Hex(token))).get();
}

function statusError(status: InvitationStatus): AppError {
    switch (status) {
        case "used":
            return new AppError(410, "invite.used");
        case "revoked":
            return new AppError(410, "invite.revoked");
        case "expired":
            return new AppError(410, "invite.expired");
        default:
            return new AppError(404, "invite.notFound");
    }
}

/** Открытие ссылки приглашение не гасит */
export async function viewInvitation(ctx: Ctx) {
    await enforceRateLimit(ctx.env.DB, `invite-view:${clientIp(ctx.request)}`, 120, 15 * 60_000, ctx.now);
    const invitation = await findByToken(ctx, ctx.params["token"] ?? "");
    if (!invitation) throw new AppError(404, "invite.notFound");
    const status = invitationStatus(invitation, ctx.now);
    if (status !== "active") throw statusError(status);
    const company = await ctx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, invitation.companyId)).get();
    const branch = invitation.branchId
        ? await ctx.db.select({ name: branches.name }).from(branches).where(eq(branches.id, invitation.branchId)).get()
        : undefined;
    return {
        kind: invitation.kind,
        role: invitation.role,
        companyName: company?.name ?? "",
        branchName: branch?.name ?? null,
        expiresAt: invitation.expiresAt,
        note: invitation.note,
    };
}

/**
 * Регистрация по приглашению. Ошибка формы приглашение не гасит.
 * Погашение и создание пользователя — одна атомарная пачка D1 (batch = транзакция):
 * UPDATE ставит одноразовый маркер, INSERT создаёт пользователя только при совпадении маркера.
 * Повторная отправка той же формы второго пользователя не создаст.
 */
export async function acceptInvitation(ctx: Ctx) {
    await enforceRateLimit(ctx.env.DB, `invite-accept:${clientIp(ctx.request)}`, 30, 15 * 60_000, ctx.now);
    const invitation = await findByToken(ctx, ctx.params["token"] ?? "");
    if (!invitation) throw new AppError(404, "invite.notFound");
    const status = invitationStatus(invitation, ctx.now);
    if (status !== "active") throw statusError(status);

    const body = await readJson(ctx.request);
    const displayName = readDisplayName(body);
    const loginValue = readLogin(body);
    const password = readNewPassword(body);

    if (invitation.kind === "activation" && (await directorExists(ctx, invitation.companyId))) throw new AppError(410, "owner.alreadyActivated");
    if (invitation.branchId) {
        const branch = await ctx.db.select().from(branches).where(eq(branches.id, invitation.branchId)).get();
        if (!branch || branch.archivedAt !== null) throw new AppError(410, "invite.revoked");
    }

    const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.login, loginValue)).get();
    if (existing) throw badRequest("validation.loginTaken", { login: "validation.loginTaken" });

    const passwordHash = await hashPassword(password);
    const userId = newId();
    const nonce = randomToken();
    const d1 = ctx.env.DB;
    try {
        await d1.batch([
            d1
                .prepare(
                    `UPDATE invitations SET used_at = ?1, used_by_user_id = ?2, consume_nonce = ?3
                     WHERE id = ?4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1
                       AND (kind <> 'activation' OR NOT EXISTS (SELECT 1 FROM users WHERE company_id = invitations.company_id AND role = 'director'))`
                )
                .bind(ctx.now, userId, nonce, invitation.id),
            d1
                .prepare(
                    `INSERT INTO users (id, company_id, login, display_name, password_hash, role, branch_id, status, created_at, updated_at, last_login_at)
                     SELECT ?1, company_id, ?2, ?3, ?4, role, branch_id, 'active', ?5, ?5, ?5
                     FROM invitations WHERE id = ?6 AND consume_nonce = ?7`
                )
                .bind(userId, loginValue, displayName, passwordHash, ctx.now, invitation.id, nonce),
            d1
                .prepare(
                    `INSERT INTO audit_log (id, company_id, actor_user_id, action, entity_type, entity_id, data, created_at)
                     SELECT ?1, company_id, ?2, 'invitation.accept', 'invitation', id, ?3, ?4
                     FROM invitations WHERE id = ?5 AND consume_nonce = ?6`
                )
                .bind(newId(), userId, JSON.stringify({ role: invitation.role, branchId: invitation.branchId }), ctx.now, invitation.id, nonce),
        ]);
    } catch (error) {
        if (isUniqueViolation(error)) throw badRequest("validation.loginTaken", { login: "validation.loginTaken" });
        throw error;
    }

    const created = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
    if (!created) {
        // Кто-то успел зарегистрироваться по этой ссылке параллельно.
        throw new AppError(410, "invite.used");
    }
    await createSession(ctx, userId);
    return { ok: true };
}

// --- Директор и руководитель: управление приглашениями ---

function assertCanInvite(actor: Actor, role: Role) {
    if (actor.role === "director") return;
    if (actor.role === "manager" && role === "employee") return;
    throw new AppError(403, "auth.forbidden");
}

export async function createInvitation(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const body = await readJson(ctx.request);
    const role = str(body, "role", { max: 20 }) as Role;
    if (!["director", "manager", "employee"].includes(role)) throw badRequest("validation.invalidInput", { role: "validation.invalidInput" });
    assertCanInvite(actor, role);
    const note = optStr(body, "note", 200);

    let branchId: string | null = null;
    if (role !== "director") {
        if (actor.role === "manager") {
            branchId = actor.branchId;
        } else {
            const requested = optStr(body, "branchId", 64);
            if (!requested) throw badRequest("validation.branchRequired", { branchId: "validation.branchRequired" });
            branchId = (await loadCompanyBranch(ctx, actor, requested)).id;
        }
        if (!branchId) throw new AppError(403, "auth.forbidden");
    }
    return issueInvitation(ctx, {
        kind: "invite",
        companyId: actor.companyId,
        branchId,
        role,
        note,
        createdBy: actor.userId,
        ttlHours: readTtlHours(body, companyConfig.invitationTtlHours),
    });
}

export async function listInvitations(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const scope = await resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true });
    const conditions = [eq(invitations.companyId, actor.companyId), eq(invitations.kind, "invite")];
    if (scope.kind === "one") conditions.push(eq(invitations.branchId, scope.branchId));
    const rows = await ctx.db
        .select({
            id: invitations.id,
            role: invitations.role,
            branchId: invitations.branchId,
            branchName: branches.name,
            note: invitations.note,
            createdAt: invitations.createdAt,
            expiresAt: invitations.expiresAt,
            usedAt: invitations.usedAt,
            revokedAt: invitations.revokedAt,
            usedBy: users.displayName,
        })
        .from(invitations)
        .leftJoin(branches, eq(branches.id, invitations.branchId))
        .leftJoin(users, eq(users.id, invitations.usedByUserId))
        .where(and(...conditions))
        .orderBy(desc(invitations.createdAt))
        .limit(200)
        .all();
    const visible = actor.role === "manager" ? rows.filter((row) => row.role === "employee") : rows;
    return { invitations: visible.map((row) => ({ ...row, status: invitationStatus(row, ctx.now) })) };
}

/** Приглашение компании, которым может управлять пользователь (руководитель — только сотрудники своего филиала) */
async function loadManagedInvitation(ctx: Ctx, actor: Actor) {
    const invitation = await ctx.db
        .select()
        .from(invitations)
        .where(and(eq(invitations.id, ctx.params["id"] ?? ""), eq(invitations.companyId, actor.companyId), eq(invitations.kind, "invite")))
        .get();
    if (!invitation) throw new AppError(404, "error.notFound");
    if (actor.role === "manager" && (invitation.branchId !== actor.branchId || invitation.role !== "employee")) {
        throw new AppError(404, "error.notFound");
    }
    return invitation;
}

export async function revokeInvitation(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const invitation = await loadManagedInvitation(ctx, actor);
    if (invitation.usedAt === null && invitation.revokedAt === null) {
        await ctx.db
            .update(invitations)
            .set({ revokedAt: ctx.now, revokedBy: actor.userId })
            .where(and(eq(invitations.id, invitation.id)));
        await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "invitation.revoke", entityType: "invitation", entityId: invitation.id }, ctx.now);
    }
    return { ok: true };
}

/**
 * Перевыпуск: новая ссылка с теми же ролью, филиалом и пометкой; старая ссылка
 * отключается в том же действии. Использованное приглашение перевыпустить нельзя.
 */
export async function reissueInvitation(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const invitation = await loadManagedInvitation(ctx, actor);
    if (invitation.usedAt !== null) throw new AppError(409, "invite.used");
    if (invitation.branchId) {
        const branch = await ctx.db.select().from(branches).where(eq(branches.id, invitation.branchId)).get();
        if (!branch || branch.archivedAt !== null) throw new AppError(409, "branches.notFound");
    }
    const body = await readJson(ctx.request);
    if (invitation.revokedAt === null) {
        await ctx.db.update(invitations).set({ revokedAt: ctx.now, revokedBy: actor.userId }).where(and(eq(invitations.id, invitation.id), isNull(invitations.revokedAt)));
    }
    const issued = await issueInvitation(ctx, {
        kind: "invite",
        companyId: actor.companyId,
        branchId: invitation.branchId,
        role: invitation.role,
        note: invitation.note,
        createdBy: actor.userId,
        ttlHours: readTtlHours(body, companyConfig.invitationTtlHours),
    });
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "invitation.reissue", entityType: "invitation", entityId: issued.id, data: { previous: invitation.id, role: invitation.role, branchId: invitation.branchId } }, ctx.now);
    return issued;
}
