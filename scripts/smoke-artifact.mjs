// Проверка собранного артефакта: dist/server/index.js в Miniflare с D1,
// миграции из dist/.openai/drizzle применяются с нуля, затем реальные запросы.
// Запуск после `npm run build`: node scripts/smoke-artifact.mjs
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";

const root = process.cwd();
const serverDir = resolve(root, "dist/server");
const modules = {};
for (const file of await readdir(serverDir, { recursive: true })) {
    if (file.endsWith(".js")) modules[file] = { type: "esm", contents: await readFile(resolve(serverDir, file), "utf8") };
}

const mf = new Miniflare({
    workers: [
        {
            config: {
                name: "smoke",
                compatibilityDate: "2026-09-21",
                compatibilityFlags: ["nodejs_compat"],
                manifest: { mainModule: "index.js", modulesRoot: serverDir, modules },
                env: {
                    DB: { type: "d1", name: "smoke-db" },
                    BUCKET: { type: "r2", name: "smoke-bucket" },
                    ASSETS: { type: "assets" },
                    OWNER_ACTIVATION_CODE: { type: "text", value: "smoke-owner-code" },
                },
                assets: { directory: resolve(root, "dist/client"), hasUserWorker: true },
            },
        },
    ],
});

let failed = false;
const check = (ok, message) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
    if (!ok) failed = true;
};

try {
    const db = await mf.getD1Database("DB");
    const journal = JSON.parse(await readFile("dist/.openai/drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) {
        const sql = await readFile(`dist/.openai/drizzle/${entry.tag}.sql`, "utf8");
        const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
        await db.batch(statements.map((s) => db.prepare(s)));
    }
    check(true, `миграции применены с нуля: ${journal.entries.map((e) => e.tag).join(", ")}`);
    const empty = await db.prepare("SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM companies) + (SELECT COUNT(*) FROM branches) AS n").first();
    check(empty.n === 0, "чистый запуск: нет сотрудников, компаний и филиалов");

    const base = "https://smoke.example";
    const login = await mf.dispatchFetch(`${base}/login`);
    const html = await login.text();
    check(login.status === 200 && html.includes("Вход"), `GET /login → ${login.status}, русский интерфейс`);
    check(login.headers.get("x-frame-options") === "DENY", "заголовки безопасности на страницах");

    const me = await mf.dispatchFetch(`${base}/api/me`);
    check(me.status === 401, `GET /api/me без входа → ${me.status}`);

    const post = (path, body, cookie) =>
        mf.dispatchFetch(`${base}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-asc-request": "1", ...(cookie ? { cookie } : {}) },
            body: JSON.stringify(body),
        });
    const issued = await post("/api/owner/activation-links", { code: "smoke-owner-code", companyName: "Smoke" });
    const issuedBody = await issued.json();
    check(issued.status === 200 && issuedBody.path?.startsWith("/activate/"), `владелец выпускает ссылку активации → ${issued.status}`);
    const token = issuedBody.path.split("/").pop();
    const accepted = await post(`/api/invitations/by-token/${token}/accept`, { displayName: "Smoke Director", login: "smoke", password: "smoke-password-1" });
    const cookie = (accepted.headers.get("set-cookie") ?? "").split(";")[0];
    check(accepted.status === 200 && cookie.startsWith("asc_session="), `активация директора в Workers-рантайме (PBKDF2 Web Crypto) → ${accepted.status}`);
    const setCookie = accepted.headers.get("set-cookie") ?? "";
    check(/HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie), "cookie сессии: HttpOnly; Secure; SameSite=Lax");
    const meAfter = await mf.dispatchFetch(`${base}/api/me`, { headers: { cookie } });
    const meBody = await meAfter.json();
    check(meAfter.status === 200 && meBody.user?.role === "director", "директор вошёл, /api/me отвечает");
    check(meAfter.headers.get("cache-control")?.includes("no-store"), "ответы API не кэшируются");
    const branch = await post("/api/branches", { name: "Smoke-филиал" }, cookie);
    check(branch.status === 200, `создание филиала → ${branch.status}`);
    const asset = await mf.dispatchFetch(`${base}/favicon.svg`);
    check(asset.status === 200, `статический файл → ${asset.status}`);
} finally {
    await mf.dispose();
}
process.exit(failed ? 1 : 0);
