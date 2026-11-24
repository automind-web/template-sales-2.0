import { handleApiRequest } from "../../server/router.ts";
import type { Env } from "../../server/runtime.ts";
import { applyMigrations, TestD1 } from "./d1.ts";

export const OWNER_CODE = "owner-secret-code-for-tests";

export function createTestEnv(overrides: Partial<Env> = {}): Env & { DB: TestD1 } {
    const db = new TestD1();
    applyMigrations(db);
    return { DB: db, OWNER_ACTIVATION_CODE: OWNER_CODE, ...overrides } as Env & { DB: TestD1 };
}

export type ApiResult<T = Record<string, unknown>> = { status: number; body: T & { error?: { code: string; message: string; fields?: Record<string, string> } } };

/** Клиент с собственной «банкой cookie», как отдельный браузер */
export class TestClient {
    readonly env: Env;
    readonly cookies = new Map<string, string>();
    ip: string;

    constructor(env: Env, ip = "10.0.0.1") {
        this.env = env;
        this.ip = ip;
    }

    async request<T = Record<string, unknown>>(method: string, path: string, body?: unknown, options: { csrf?: boolean } = {}): Promise<ApiResult<T>> {
        const headers = new Headers({ "cf-connecting-ip": this.ip, "user-agent": "test-agent" });
        if (body !== undefined) headers.set("content-type", "application/json");
        if (method !== "GET" && options.csrf !== false) headers.set("x-asc-request", "1");
        if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
        const response = await handleApiRequest(
            new Request(`https://sales.example${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
            this.env
        );
        for (const cookie of response.headers.getSetCookie()) {
            const [pair] = cookie.split(";");
            const index = pair!.indexOf("=");
            const name = pair!.slice(0, index);
            const value = decodeURIComponent(pair!.slice(index + 1));
            if (/Max-Age=0/.test(cookie) || value === "") this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
        return { status: response.status, body: (await response.json()) as ApiResult<T>["body"] };
    }

    get<T = Record<string, unknown>>(path: string) {
        return this.request<T>("GET", path);
    }
    post<T = Record<string, unknown>>(path: string, body: unknown = {}) {
        return this.request<T>("POST", path, body);
    }
    put<T = Record<string, unknown>>(path: string, body: unknown = {}) {
        return this.request<T>("PUT", path, body);
    }
    patch<T = Record<string, unknown>>(path: string, body: unknown = {}) {
        return this.request<T>("PATCH", path, body);
    }
    delete<T = Record<string, unknown>>(path: string) {
        return this.request<T>("DELETE", path);
    }
}

export function tokenFromPath(path: string): string {
    return path.split("/").pop() ?? "";
}

/** Полная подготовка: владелец выпускает ссылку, директор активируется */
export async function bootstrapDirector(env: Env, login = "director") {
    const owner = new TestClient(env, "10.9.9.9");
    const issued = await owner.post<{ path: string }>("/api/owner/activation-links", { code: OWNER_CODE, companyName: "Тестовая компания" });
    if (issued.status !== 200) throw new Error(`activation failed: ${JSON.stringify(issued.body)}`);
    const director = new TestClient(env, "10.0.0.2");
    const accepted = await director.post(`/api/invitations/by-token/${tokenFromPath(issued.body.path)}/accept`, {
        displayName: "Директор Тестов",
        login,
        password: "director-password-1",
    });
    if (accepted.status !== 200) throw new Error(`director accept failed: ${JSON.stringify(accepted.body)}`);
    return director;
}

export async function invite(env: Env, by: TestClient, payload: { role: string; branchId?: string; note?: string }, login: string, displayName = "Сотрудник Тестов") {
    const created = await by.post<{ path: string }>("/api/invitations", payload);
    if (created.status !== 200) throw new Error(`invite failed: ${JSON.stringify(created.body)}`);
    const client = new TestClient(env, `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
    const accepted = await client.post(`/api/invitations/by-token/${tokenFromPath(created.body.path)}/accept`, {
        displayName,
        login,
        password: "employee-password-1",
    });
    if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
    return client;
}
