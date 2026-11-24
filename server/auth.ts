import { and, eq, isNull, ne } from "drizzle-orm";
import { companyConfig } from "../config/company.ts";
import { admissions, sessions, users, type Role } from "../db/schema.ts";
import type { Ctx } from "./context.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { AppError, serializeCookie } from "./http.ts";

export const SESSION_COOKIE = "asc_session";
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

/** Пользователь текущего запроса. Читается из БД при каждом запросе. */
export type Actor = {
    userId: string;
    companyId: string;
    role: Role;
    /** Филиал сотрудника/руководителя; у директора null */
    branchId: string | null;
    displayName: string;
    login: string;
    /** Допуск к CRM/KPI. Директор и руководитель допущены всегда. */
    admitted: boolean;
    sessionId: string;
    /** Выбор директора в шапке: id филиала, '*' (все) или null (не выбран) */
    selectedBranchId: string | null;
};

export async function loadActor(ctx: Ctx): Promise<Actor | null> {
    if (ctx.actor !== undefined) return ctx.actor;
    ctx.actor = null;
    const token = ctx.cookies.get(SESSION_COOKIE);
    if (!token || token.length > 100) return null;
    const sessionId = await sha256Hex(token);

    const row = await ctx.db
        .select({
            sessionId: sessions.id,
            expiresAt: sessions.expiresAt,
            revokedAt: sessions.revokedAt,
            lastSeenAt: sessions.lastSeenAt,
            selectedBranchId: sessions.selectedBranchId,
            userId: users.id,
            companyId: users.companyId,
            role: users.role,
            branchId: users.branchId,
            displayName: users.displayName,
            login: users.login,
            status: users.status,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, sessionId))
        .get();

    if (!row || row.revokedAt !== null || row.expiresAt <= ctx.now || row.status !== "active") {
        if (row) ctx.setCookies.push(clearSessionCookie());
        return null;
    }

    let admitted = row.role !== "employee";
    if (!admitted) {
        const admission = await ctx.db
            .select({ id: admissions.id })
            .from(admissions)
            .where(and(eq(admissions.userId, row.userId), isNull(admissions.revokedAt)))
            .limit(1)
            .get();
        admitted = Boolean(admission);
    }

    if (ctx.now - row.lastSeenAt > LAST_SEEN_THROTTLE_MS) {
        await ctx.db.update(sessions).set({ lastSeenAt: ctx.now }).where(eq(sessions.id, sessionId));
    }

    ctx.actor = {
        userId: row.userId,
        companyId: row.companyId,
        role: row.role,
        branchId: row.branchId,
        displayName: row.displayName,
        login: row.login,
        admitted,
        sessionId: row.sessionId,
        selectedBranchId: row.selectedBranchId,
    };
    return ctx.actor;
}

export async function requireActor(ctx: Ctx): Promise<Actor> {
    const actor = await loadActor(ctx);
    if (!actor) throw new AppError(401, "auth.required");
    return actor;
}

export function requireRole(actor: Actor, ...roles: Role[]): void {
    if (!roles.includes(actor.role)) throw new AppError(403, "auth.forbidden");
}

export async function createSession(ctx: Ctx, userId: string): Promise<void> {
    const token = randomToken();
    const id = await sha256Hex(token);
    const ttlMs = companyConfig.sessionTtlDays * 24 * 60 * 60_000;
    await ctx.db.insert(sessions).values({
        id,
        userId,
        createdAt: ctx.now,
        expiresAt: ctx.now + ttlMs,
        lastSeenAt: ctx.now,
        userAgent: (ctx.request.headers.get("user-agent") ?? "").slice(0, 300) || null,
    });
    ctx.setCookies.push(serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: Math.floor(ttlMs / 1000) }));
    ctx.actor = undefined;
}

export function clearSessionCookie(): string {
    return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 });
}

export async function revokeAllSessions(ctx: Ctx, userId: string, exceptSessionId?: string): Promise<void> {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
    await ctx.db.update(sessions).set({ revokedAt: ctx.now }).where(and(...conditions));
}
