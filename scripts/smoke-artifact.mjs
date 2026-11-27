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
                    INTEGRATION_TOKEN: { type: "text", value: "smoke-integration-token" },
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

    // Обучение: файл в R2 и редакция через интерфейс интеграции
    const auth = { authorization: "Bearer smoke-integration-token" };
    const form = new FormData();
    form.set("courseKey", "sales-basics");
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "memo.pdf", { type: "application/pdf" }));
    // Miniflare не передаёт FormData из Node как есть — отправляем готовые байты multipart.
    const encoded = new Response(form);
    const multipart = new Uint8Array(await encoded.arrayBuffer());
    const uploaded = await mf.dispatchFetch(`${base}/api/integration/training/files`, {
        method: "POST",
        headers: { ...auth, "content-type": encoded.headers.get("content-type") },
        body: multipart,
    });
    const uploadedBody = await uploaded.json();
    check(uploaded.status === 200 && uploadedBody.fileId, `файл материала в R2 через интеграцию → ${uploaded.status} ${uploaded.status === 200 ? "" : JSON.stringify(uploadedBody)}`);
    const edition = {
        approved: true,
        externalRef: "smoke-1",
        title: "Smoke course",
        lessons: [{ key: "l1", title: "Lesson", body: "Text", fileIds: [uploadedBody.fileId] }],
        test: { passPercent: 80, questions: [{ key: "q1", text: "?", kind: "single", options: [{ key: "a", text: "A" }, { key: "b", text: "B" }], correct: ["a"] }] },
    };
    const published = await mf.dispatchFetch(`${base}/api/integration/training/courses/sales-basics/versions`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(edition) });
    const publishedBody = await published.json();
    check(published.status === 200 && publishedBody.version === 1, `редакция курса опубликована → ${published.status}, версия ${publishedBody.version}`);
    const denied = await mf.dispatchFetch(`${base}/api/integration/training/courses/sales-basics/versions`, { method: "POST", headers: { authorization: "Bearer wrong", "content-type": "application/json" }, body: JSON.stringify(edition) });
    check(denied.status === 401, `интеграция с неверным токеном → ${denied.status}`);
    const fileResponse = await mf.dispatchFetch(`${base}/api/training/files/${uploadedBody.fileId}`, { headers: { cookie } });
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
    check(fileResponse.status === 200 && fileBytes.length === 4, `файл скачивается из R2 с проверкой прав → ${fileResponse.status}`);
    const anonymousFile = await mf.dispatchFetch(`${base}/api/training/files/${uploadedBody.fileId}`);
    check(anonymousFile.status === 401, `файл без входа → ${anonymousFile.status}`);

    // CRM, статистика и WhatsApp Studio в Workers-рантайме
    const send = (method, path, body) =>
        mf.dispatchFetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-asc-request": "1", cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const lead = await send("POST", "/api/crm/leads", { opId: "smoke-op-00000001", clientName: "Smoke client", clientPhone: "+77010000000" });
    const leadBody = await lead.json();
    check(lead.status === 200 && leadBody.lead?.number === 1, `лид создан (D1 batch) → ${lead.status}`);
    const moved = await send("PATCH", `/api/crm/leads/${leadBody.lead.id}`, { opId: "smoke-op-00000002", version: 1, changes: { stage: "contact", nextContactAt: Date.now() + 86400000 } });
    check(moved.status === 200, `смена этапа → ${moved.status}`);
    const stats = await mf.dispatchFetch(`${base}/api/stats`, { headers: { cookie } });
    const statsBody = await stats.json();
    check(stats.status === 200 && statsBody.totals?.values?.leads_created === 1, `статистика считает лид → ${stats.status}`);
    // WhatsApp Studio: агент, ключ шифруется ключом сайта (AES-GCM в Workers), база знаний, адрес приёма сообщений
    const agent = await send("POST", "/api/wa/agents", { name: "Консультант" });
    const agentBody = await agent.json();
    check(agent.status === 201 && agentBody.agent?.prompt?.includes("«Smoke»"), `агент WhatsApp создан со стартовой инструкцией → ${agent.status}`);
    const key = await send("POST", `/api/wa/agents/${agentBody.agent.id}/credentials`, { provider: "openai", token: "sk-smoke-test-key-123456" });
    const keyText = await key.text();
    check(key.status === 200 && !keyText.includes("sk-smoke-test-key"), `ключ сохранён и не возвращается в браузер → ${key.status}`);
    const docs = await send("POST", `/api/wa/agents/${agentBody.agent.id}/documents/files`, { files: [{ name: "Доставка.txt", content: "Доставка по городу занимает 1 день.", byte_size: 60 }] });
    const docsBody = await docs.json();
    check(docs.status === 200 && docsBody.results?.[0]?.status === "added", `материал в базе знаний → ${docs.status}`);
    const hook = await mf.dispatchFetch(`${base}/api/wa/webhooks/whapi/${agentBody.agent.id}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "wrong" }, body: "{}" });
    check(hook.status === 401, `приём сообщений с неверным секретом → ${hook.status}`);

    const asset = await mf.dispatchFetch(`${base}/favicon.svg`);
    check(asset.status === 200, `статический файл → ${asset.status}`);
} finally {
    await mf.dispose();
}
process.exit(failed ? 1 : 0);
