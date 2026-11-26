/**
 * Whapi (gate.whapi.cloud): состояние канала, отправка текста, настройка webhook.
 * Токен — секрет WHAPI_TOKEN сайта; в браузер и журналы не попадает.
 */
const BASE = "https://gate.whapi.cloud";

/** Реальное состояние канала и способ восстановления (ключи текстов в словаре) */
export type ChannelState = "connected" | "qr" | "starting" | "unauthorized" | "unavailable" | "not_configured";

export type HealthResult = { state: ChannelState; detail: string | null };

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
        signal: AbortSignal.timeout(15_000),
    });
}

export async function health(token: string | null): Promise<HealthResult> {
    if (!token) return { state: "not_configured", detail: null };
    try {
        const response = await call(token, "/health");
        if (response.status === 401 || response.status === 403) return { state: "unauthorized", detail: `HTTP ${response.status}` };
        if (!response.ok) return { state: "unavailable", detail: `HTTP ${response.status}` };
        const data = (await response.json()) as { status?: { code?: number; text?: string } };
        const text = String(data.status?.text ?? "").toUpperCase();
        if (text === "AUTH") return { state: "connected", detail: text };
        if (text === "QR") return { state: "qr", detail: text };
        return { state: "starting", detail: text || null };
    } catch (error) {
        return { state: "unavailable", detail: error instanceof Error ? error.message : String(error) };
    }
}

/** Направляет входящие сообщения на webhook сайта */
export async function setWebhook(token: string, url: string): Promise<{ ok: boolean; detail: string | null }> {
    try {
        const response = await call(token, "/settings", {
            method: "PATCH",
            body: JSON.stringify({ webhooks: [{ url, events: [{ type: "messages", method: "post" }], mode: "body" }] }),
        });
        return { ok: response.ok, detail: response.ok ? null : `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}

export async function sendText(token: string, to: string, body: string): Promise<{ ok: boolean; detail: string | null }> {
    try {
        const response = await call(token, "/messages/text", { method: "POST", body: JSON.stringify({ to, body }) });
        return { ok: response.ok, detail: response.ok ? null : `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}

/** «77011112233@s.whatsapp.net» → «+77011112233»; группы и рассылки не обрабатываем */
export function phoneFromChat(chatId: string): string | null {
    const match = /^(\d{6,15})@s\.whatsapp\.net$/.exec(chatId);
    return match ? `+${match[1]}` : null;
}
