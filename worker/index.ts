import {
    DEFAULT_DEVICE_SIZES,
    DEFAULT_IMAGE_SIZES,
    handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runWithEnv, type Env } from "../server/runtime.ts";

interface AssetFetcher {
    fetch(request: Request): Promise<Response>;
}

interface ImageTransformer {
    output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
}

interface ImageBinding {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): ImageTransformer };
}

interface WorkerEnv extends Env {
    ASSETS: AssetFetcher;
    IMAGES: ImageBinding;
}

interface ExecutionContext {
    passThroughOnException(): void;
    waitUntil(promise: Promise<unknown>): void;
}

const SECURITY_HEADERS: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function withSecurityHeaders(response: Response): Response {
    // Ответы могут быть неизменяемыми (ассеты) — копируем при необходимости.
    let result = response;
    try {
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(name, value);
    } catch {
        result = new Response(response.body, response);
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.headers.set(name, value);
    }
    return result;
}

const worker = {
    async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/_vinext/image") {
            const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
            return handleImageOptimization(
                request,
                {
                    fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
                    transformImage: async (body, { width, format, quality }) => {
                        const transformOptions = width > 0 ? { width } : {};
                        const result = await env.IMAGES.input(body).transform(transformOptions).output({ format, quality });
                        return result.response();
                    },
                },
                allowedWidths
            );
        }

        if (import.meta.env.DEV) {
            // Только локальная разработка: Sites применяет миграции сам перед публикацией.
            const { applyDevMigrations } = await import("../server/dev-migrate.ts");
            await applyDevMigrations(env.DB);
        }

        return runWithEnv(env, async () => withSecurityHeaders(await handler.fetch(request, env, ctx)), (promise) => ctx.waitUntil(promise));
    },

    /**
     * Расписание Sites (если включено для сайта): короткий повтор неотправленных
     * ответов WhatsApp. Без расписания повтор идёт при входящих и по кнопке.
     */
    async scheduled(_event: unknown, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
        const { retryPending } = await import("../server/whatsapp/service.ts");
        ctx.waitUntil(runWithEnv(env, () => retryPending(env, Date.now(), { limit: 20, minAgeMs: 60_000 })).then(() => undefined));
    },
};

export default worker;
