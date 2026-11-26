import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { branches, companies, passwordResetCodes, sessions, users } from "../../db/schema.ts";
import { canUseSection, loadCompanyBranch, sectionMap, singleBranchId } from "../access.ts";
import { audit } from "../audit.ts";
import { clearSessionCookie, createSession, loadActor, requireActor, revokeAllSessions } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { DUMMY_PASSWORD_HASH, hashPassword, sha256Hex, timingSafeEqual, verifyPassword } from "../crypto.ts";
import { AppError, badRequest, clientIp, readJson, str } from "../http.ts";
import { clearRateLimit, enforceRateLimit } from "../rate-limit.ts";
import { normalizeLogin, readDisplayName, readNewPassword } from "../validation.ts";

const LOGIN_WINDOW_MS = 15 * 60_000;
const RESET_MAX_ATTEMPTS = 5;

export async function login(ctx: Ctx) {
    const body = await readJson(ctx.request);
    const loginValue = normalizeLogin(str(body, "login", { max: 64 }));
    const password = typeof body["password"] === "string" ? body["password"] : "";
    if (!password) throw badRequest("validation.invalidInput", { password: "validation.required" });

    const ip = clientIp(ctx.request);
    const loginKey = `login:${loginValue}:${ip}`;
    await enforceRateLimit(ctx.env.DB, loginKey, 10, LOGIN_WINDOW_MS, ctx.now);
    await enforceRateLimit(ctx.env.DB, `login-ip:${ip}`, 60, LOGIN_WINDOW_MS, ctx.now);

    const user = await ctx.db.select().from(users).where(eq(users.login, loginValue)).get();
    // Проверяем пароль и для несуществующего логина, чтобы время ответа не выдавало логины.
    const check = await verifyPassword(password.slice(0, 500), user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !check.ok) throw new AppError(401, "auth.login.invalid");
    if (user.status !== "active") throw new AppError(403, "auth.login.disabled");

    const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: ctx.now };
    if (check.needsRehash) updates.passwordHash = await hashPassword(password);
    await ctx.db.update(users).set(updates).where(eq(users.id, user.id));
    await clearRateLimit(ctx.env.DB, loginKey);
    await createSession(ctx, user.id);
    return { ok: true };
}

export async function logout(ctx: Ctx) {
    const actor = await loadActor(ctx);
    if (actor) await ctx.db.update(sessions).set({ revokedAt: ctx.now }).where(eq(sessions.id, actor.sessionId));
    ctx.setCookies.push(clearSessionCookie());
    return { ok: true };
}

export async function me(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const company = await ctx.db.select().from(companies).where(eq(companies.id, actor.companyId)).get();
    if (!company) throw new AppError(500, "error.internal");

    const branchConditions = [eq(branches.companyId, actor.companyId), isNull(branches.archivedAt)];
    if (actor.role !== "director" && actor.branchId) branchConditions.push(eq(branches.id, actor.branchId));
    const visibleBranches =
        actor.role === "director" || actor.branchId
            ? await ctx.db
                  .select({ id: branches.id, name: branches.name, city: branches.city })
                  .from(branches)
                  .where(and(...branchConditions))
                  .orderBy(branches.name)
                  .all()
            : [];

    let selectedBranchId: string | null;
    if (actor.role === "director") {
        const single = await singleBranchId(ctx, actor.companyId);
        const stored = actor.selectedBranchId;
        const storedIsValid = stored === "*" || visibleBranches.some((branch) => branch.id === stored);
        selectedBranchId = single ?? (storedIsValid ? stored : "*");
    } else {
        selectedBranchId = actor.branchId;
    }

    const ownBranch = actor.branchId
        ? await ctx.db.select({ name: branches.name }).from(branches).where(eq(branches.id, actor.branchId)).get()
        : undefined;

    return {
        user: {
            id: actor.userId,
            displayName: actor.displayName,
            login: actor.login,
            role: actor.role,
            branchId: actor.branchId,
            branchName: ownBranch?.name ?? null,
            admitted: actor.admitted,
        },
        company: { id: company.id, name: company.name, timezone: company.timezone },
        branches: visibleBranches,
        selectedBranchId,
        canSelectAllBranches: actor.role === "director",
        sections: sectionMap(actor),
    };
}

/** Своё имя меняет сам пользователь (профиль → «Личные данные») */
export async function updateMe(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const displayName = readDisplayName(body);
    await ctx.db.update(users).set({ displayName, updatedAt: ctx.now }).where(eq(users.id, actor.userId));
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "profile.update", entityType: "user", entityId: actor.userId, data: { displayName } }, ctx.now);
    return { ok: true, displayName };
}

export async function selectBranch(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role !== "director") throw new AppError(403, "auth.forbidden");
    const body = await readJson(ctx.request);
    const branchId = str(body, "branchId", { max: 64 });
    if (branchId !== "*") await loadCompanyBranch(ctx, actor, branchId);
    await ctx.db.update(sessions).set({ selectedBranchId: branchId }).where(eq(sessions.id, actor.sessionId));
    return { ok: true, selectedBranchId: branchId };
}

export async function sectionCheck(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const key = ctx.params["section"] ?? "";
    const map = sectionMap(actor);
    if (!(key in map)) throw new AppError(404, "error.notFound");
    if (!canUseSection(actor, key as keyof typeof map)) throw new AppError(403, "shell.sectionLocked");
    return { ok: true };
}

export async function changePassword(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const current = typeof body["currentPassword"] === "string" ? body["currentPassword"] : "";
    const next = readNewPassword(body, "newPassword");
    await enforceRateLimit(ctx.env.DB, `password:${actor.userId}`, 10, LOGIN_WINDOW_MS, ctx.now);
    const user = await ctx.db.select().from(users).where(eq(users.id, actor.userId)).get();
    if (!user) throw new AppError(401, "auth.required");
    const check = await verifyPassword(current.slice(0, 500), user.passwordHash);
    if (!check.ok) throw badRequest("profile.wrongPassword", { currentPassword: "profile.wrongPassword" });
    await ctx.db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: ctx.now }).where(eq(users.id, user.id));
    await revokeAllSessions(ctx, user.id, actor.sessionId);
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "password.change", entityType: "user", entityId: actor.userId }, ctx.now);
    return { ok: true };
}

export async function listSessions(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const rows = await ctx.db
        .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent })
        .from(sessions)
        .where(and(eq(sessions.userId, actor.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, ctx.now)))
        .orderBy(desc(sessions.lastSeenAt))
        .all();
    // Наружу отдаём только короткий публичный идентификатор (префикс хэша), а не сам ключ сессии.
    return {
        sessions: rows.map((row) => ({
            id: row.id.slice(0, 16),
            current: row.id === actor.sessionId,
            createdAt: row.createdAt,
            lastSeenAt: row.lastSeenAt,
            userAgent: row.userAgent,
        })),
    };
}

export async function revokeSession(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const publicId = ctx.params["id"] ?? "";
    if (!/^[0-9a-f]{16}$/.test(publicId)) throw new AppError(404, "error.notFound");
    const rows = await ctx.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, actor.userId), isNull(sessions.revokedAt)))
        .all();
    const target = rows.find((row) => row.id.startsWith(publicId));
    if (!target) throw new AppError(404, "error.notFound");
    await ctx.db.update(sessions).set({ revokedAt: ctx.now }).where(eq(sessions.id, target.id));
    if (target.id === actor.sessionId) ctx.setCookies.push(clearSessionCookie());
    return { ok: true };
}

/** Смена пароля по одноразовому коду от директора или руководителя */
export async function resetPassword(ctx: Ctx) {
    const body = await readJson(ctx.request);
    const loginValue = normalizeLogin(str(body, "login", { max: 64 }));
    const code = str(body, "code", { max: 64 }).toUpperCase().replace(/[\s-]/g, "");
    const password = readNewPassword(body, "password");
    const ip = clientIp(ctx.request);
    await enforceRateLimit(ctx.env.DB, `reset:${ip}`, 20, LOGIN_WINDOW_MS, ctx.now);

    const user = await ctx.db.select().from(users).where(eq(users.login, loginValue)).get();
    const invalid = () => new AppError(400, "reset.invalid");
    if (!user || user.status !== "active") throw invalid();
    const record = await ctx.db
        .select()
        .from(passwordResetCodes)
        .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt), gt(passwordResetCodes.expiresAt, ctx.now)))
        .orderBy(desc(passwordResetCodes.createdAt))
        .get();
    if (!record || record.attempts >= RESET_MAX_ATTEMPTS) throw invalid();
    const matches = timingSafeEqual(await sha256Hex(code), record.codeHash);
    if (!matches) {
        await ctx.db.update(passwordResetCodes).set({ attempts: record.attempts + 1 }).where(eq(passwordResetCodes.id, record.id));
        throw invalid();
    }
    const consumed = await ctx.db
        .update(passwordResetCodes)
        .set({ usedAt: ctx.now })
        .where(and(eq(passwordResetCodes.id, record.id), isNull(passwordResetCodes.usedAt)))
        .returning({ id: passwordResetCodes.id });
    if (consumed.length !== 1) throw invalid();
    await ctx.db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: ctx.now }).where(eq(users.id, user.id));
    await revokeAllSessions(ctx, user.id);
    await audit(ctx.db, { companyId: user.companyId, actorUserId: user.id, action: "password.reset", entityType: "user", entityId: user.id }, ctx.now);
    return { ok: true };
}
