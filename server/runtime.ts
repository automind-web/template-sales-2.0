import { AsyncLocalStorage } from "node:async_hooks";

/** Привязки и секреты, которые Sites передаёт Worker'у */
export type Env = {
    DB: D1Database;
    BUCKET?: R2Bucket;
    WHAPI_TOKEN?: string;
    OPENAI_API_KEY?: string;
    INTEGRATION_TOKEN?: string;
    OWNER_ACTIVATION_CODE?: string;
};

export type SecretName = "WHAPI_TOKEN" | "OPENAI_API_KEY" | "INTEGRATION_TOKEN" | "OWNER_ACTIVATION_CODE";

/** Продление работы после ответа (ctx.waitUntil Worker'а) */
export type WaitUntil = (promise: Promise<unknown>) => void;

const storage = new AsyncLocalStorage<{ env: Env; waitUntil: WaitUntil | null }>();

export function runWithEnv<T>(env: Env, callback: () => T, waitUntil: WaitUntil | null = null): T {
    return storage.run({ env, waitUntil }, callback);
}

export function getEnv(): Env {
    const store = storage.getStore();
    if (!store) throw new Error("Runtime bindings are unavailable for this request.");
    return store.env;
}

export function getWaitUntil(): WaitUntil | null {
    return storage.getStore()?.waitUntil ?? null;
}

/**
 * Секрет из настроек сайта. Ищем в привязках Worker'а, затем в process.env
 * (nodejs_compat переносит туда переменные окружения). Значение никогда не
 * уходит в ответы, журналы клиента и кэш.
 */
export function getSecret(env: Env, name: SecretName): string | null {
    const fromEnv = env[name];
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const fromProcess = proc?.env?.[name];
    return typeof fromProcess === "string" && fromProcess.length > 0 ? fromProcess : null;
}
