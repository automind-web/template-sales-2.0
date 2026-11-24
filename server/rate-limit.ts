import { AppError } from "./http.ts";
import type { MessageKey } from "../i18n/index.ts";

/**
 * Ограничение частоты на D1: фиксированное окно, атомарный UPSERT.
 * Возвращает число попыток в текущем окне.
 */
export async function hitRateLimit(
    d1: D1Database,
    key: string,
    windowMs: number,
    now: number
): Promise<{ count: number; windowStart: number }> {
    const threshold = now - windowMs;
    const row = await d1
        .prepare(
            `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
             ON CONFLICT(key) DO UPDATE SET
               count = CASE WHEN rate_limits.window_start <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
               window_start = CASE WHEN rate_limits.window_start <= ?3 THEN ?2 ELSE rate_limits.window_start END
             RETURNING count, window_start`
        )
        .bind(key, now, threshold)
        .first<{ count: number; window_start: number }>();
    return { count: Number(row?.count ?? 1), windowStart: Number(row?.window_start ?? now) };
}

export async function enforceRateLimit(
    d1: D1Database,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    message: MessageKey = "auth.login.rateLimited"
): Promise<void> {
    const { count, windowStart } = await hitRateLimit(d1, key, windowMs, now);
    if (count > limit) {
        const minutes = Math.max(1, Math.ceil((windowStart + windowMs - now) / 60_000));
        throw new AppError(429, message, { vars: { minutes } });
    }
}

export async function clearRateLimit(d1: D1Database, key: string): Promise<void> {
    await d1.prepare("DELETE FROM rate_limits WHERE key = ?1").bind(key).run();
}
