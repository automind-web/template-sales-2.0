import { t, type MessageKey } from "../i18n/index.ts";

/**
 * Ошибка приложения: HTTP-статус, машинный код и текст для пользователя.
 * Сервер отвечает { error: { code, message, fields? } }.
 */
export class AppError extends Error {
    readonly status: number;
    readonly code: MessageKey;
    readonly fields: Record<string, MessageKey> | undefined;
    readonly vars: Record<string, string | number> | undefined;
    readonly extra: Record<string, unknown> | undefined;

    constructor(
        status: number,
        code: MessageKey,
        options?: {
            fields?: Record<string, MessageKey>;
            vars?: Record<string, string | number>;
            extra?: Record<string, unknown>;
        }
    ) {
        super(code);
        this.status = status;
        this.code = code;
        this.fields = options?.fields;
        this.vars = options?.vars;
        this.extra = options?.extra;
    }
}

export const badRequest = (code: MessageKey, fields?: Record<string, MessageKey>) =>
    new AppError(400, code, fields ? { fields } : undefined);
export const forbidden = (code: MessageKey = "auth.forbidden") => new AppError(403, code);
export const notFound = (code: MessageKey = "error.notFound") => new AppError(404, code);

export function errorBody(error: AppError) {
    const fields = error.fields
        ? Object.fromEntries(Object.entries(error.fields).map(([field, key]) => [field, t(key)]))
        : undefined;
    return {
        error: {
            code: error.code,
            message: t(error.code, error.vars),
            ...(fields ? { fields } : {}),
            ...(error.extra ?? {}),
        },
    };
}

const NO_STORE = "no-store, private";

export function json(data: unknown, init?: ResponseInit & { cookies?: string[] }): Response {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    // Ответы API содержат данные конкретного пользователя: общий кэш запрещён.
    headers.set("cache-control", NO_STORE);
    headers.set("x-content-type-options", "nosniff");
    for (const cookie of init?.cookies ?? []) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: AppError): Response {
    return json(errorBody(error), { status: error.status });
}

export function parseCookies(header: string | null): Map<string, string> {
    const cookies = new Map<string, string>();
    if (!header) return cookies;
    for (const part of header.split(";")) {
        const index = part.indexOf("=");
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (name && !cookies.has(name)) {
            try {
                cookies.set(name, decodeURIComponent(value));
            } catch {
                cookies.set(name, value);
            }
        }
    }
    return cookies;
}

export function serializeCookie(
    name: string,
    value: string,
    options: { maxAgeSeconds?: number; httpOnly?: boolean } = {}
): string {
    const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "Secure", "SameSite=Lax"];
    if (options.httpOnly !== false) parts.push("HttpOnly");
    if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
    return parts.join("; ");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 1_000_000) throw badRequest("error.badJson");
    let body: unknown;
    try {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
    } catch {
        throw badRequest("error.badJson");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("error.badJson");
    return body as Record<string, unknown>;
}

// --- Небольшие валидаторы входных данных ---

export function str(body: Record<string, unknown>, key: string, options: { max?: number; optional?: boolean } = {}): string {
    const value = body[key];
    if (value === undefined || value === null || value === "") {
        if (options.optional) return "";
        throw badRequest("validation.invalidInput", { [key]: "validation.required" });
    }
    if (typeof value !== "string") throw badRequest("validation.invalidInput", { [key]: "validation.invalidInput" });
    const trimmed = value.trim();
    if (options.max !== undefined && trimmed.length > options.max) {
        throw badRequest("validation.invalidInput", { [key]: "validation.invalidInput" });
    }
    return trimmed;
}

export function optStr(body: Record<string, unknown>, key: string, max = 500): string | null {
    const value = str(body, key, { max, optional: true });
    return value === "" ? null : value;
}

export function bool(body: Record<string, unknown>, key: string): boolean {
    const value = body[key];
    if (typeof value !== "boolean") throw badRequest("validation.invalidInput", { [key]: "validation.invalidInput" });
    return value;
}

export function clientIp(request: Request): string {
    return (
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown"
    );
}
