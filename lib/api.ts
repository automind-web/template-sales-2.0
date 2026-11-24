"use client";

import { t } from "../i18n/index.ts";

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly fields: Record<string, string>;
    readonly extra: Record<string, unknown>;

    constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.extra = extra;
    }
}

export const UNAUTHORIZED_EVENT = "asc:unauthorized";

type Options = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal };

/** Запрос к серверу. Изменяющие запросы несут заголовок защиты от CSRF. */
export async function api<T = Record<string, unknown>>(path: string, options: Options = {}): Promise<T> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { accept: "application/json" };
    if (method !== "GET") headers["x-asc-request"] = "1";
    if (options.body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
        response = await fetch(path, {
            method,
            headers,
            credentials: "same-origin",
            cache: "no-store",
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new ApiError(0, "network", t("common.errorNetwork"));
    }
    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const error = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
        const { code, message, fields, ...extra } = error ?? {};
        if (response.status === 401 && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        }
        throw new ApiError(response.status, code ?? "unknown", message ?? t("common.errorGeneric"), fields ?? {}, extra);
    }
    return payload as T;
}

export function errorMessage(error: unknown): string {
    if (error instanceof ApiError) return error.message;
    return t("common.errorGeneric");
}
