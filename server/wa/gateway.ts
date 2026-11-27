/**
 * Вход в WhatsApp Studio: /api/wa/*.
 * - /api/wa/webhooks/whapi/{agentId} — входящие сообщения (секрет в заголовке, проверяет движок);
 * - остальное — только для вошедшего директора, с защитой от подделки запросов.
 * Движок студии (server/wa/*.mjs) перенесён из шаблона WhatsApp Agent Studio без изменения логики.
 */
import type { Ctx } from "../context.ts";
import { loadActor } from "../auth.ts";
import { clientIp } from "../http.ts";
import { hitRateLimit } from "../rate-limit.ts";
import type { Env } from "../runtime.ts";
import { handleApi, json } from "./api.mjs";
import { tick } from "./engine.mjs";
import { b64, unb64 } from "./vault.mjs";

const CSRF_HEADER = "x-asc-request";

function validKey(value: unknown): value is string {
    try {
        return typeof value === "string" && unb64(value).length === 32;
    } catch {
        return false;
    }
}

/**
 * Ключ шифрования сохранённых ключей подключений: секрет MASTER_KEY, если владелец
 * его задал, иначе — созданный автоматически при первом обращении (хранится только на сервере).
 */
export async function vaultKey(env: Env): Promise<string> {
    const fromEnv = env.MASTER_KEY;
    if (validKey(fromEnv)) return fromEnv;
    const stored = await env.DB.prepare("SELECT value FROM vault_keys WHERE id = 'main'").first<{ value: string }>();
    if (stored && validKey(stored.value)) return stored.value;
    const generated = b64(crypto.getRandomValues(new Uint8Array(32))) as string;
    await env.DB.prepare("INSERT OR IGNORE INTO vault_keys (id, value, created_at) VALUES ('main', ?, ?)").bind(generated, Date.now()).run();
    const saved = await env.DB.prepare("SELECT value FROM vault_keys WHERE id = 'main'").first<{ value: string }>();
    return saved!.value;
}

export async function studioEnv(env: Env, origin: string | null) {
    return { ...env, MASTER_KEY: await vaultKey(env), ...(origin ? { PUBLIC_URL: origin } : {}) };
}

const failure = (message: string, status: number, code: string) => json({ error: message, code }, status) as Response;

export async function handleStudio(ctx: Ctx): Promise<Response> {
    const path = ctx.url.pathname;
    const method = ctx.request.method.toUpperCase();
    if (path.startsWith("/api/wa/webhooks/")) {
        const { count } = await hitRateLimit(ctx.env.DB, `wa-hook:${clientIp(ctx.request)}`, 60_000, ctx.now);
        if (count > 600) return failure("Слишком много запросов.", 429, "rate_limited");
        return handleApi(ctx.request, await studioEnv(ctx.env, ctx.url.origin), null, { waitUntil: ctx.waitUntil ?? undefined });
    }
    if (method !== "GET" && ctx.request.headers.get(CSRF_HEADER) !== "1") return failure("Обновите страницу и повторите действие.", 403, "csrf");
    const actor = await loadActor(ctx);
    if (!actor) return failure("Войдите в систему.", 401, "sign_in_required");
    if (actor.role !== "director") return failure("Раздел доступен только директору.", 403, "forbidden");
    return handleApi(ctx.request, await studioEnv(ctx.env, ctx.url.origin), { userId: actor.companyId });
}

/** Короткая обработка очереди ответов (расписание сайта, если оно включено) */
export async function studioTick(env: Env): Promise<void> {
    await tick(await studioEnv(env, null), { limit: 10 });
}
