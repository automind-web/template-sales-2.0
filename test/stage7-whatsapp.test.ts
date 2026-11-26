import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest } from "../server/router.ts";
import { offlineAnswer, systemPrompt } from "../server/whatsapp/agent.ts";
import { retryPending } from "../server/whatsapp/service.ts";
import { bootstrapDirector, createTestEnv, integration, invite } from "./support/client.ts";

type Studio = {
    agent: { name: string; instructions: string; lastTest: { ok: boolean; mode: string } | null } | null;
    materials: Array<{ id: string; title: string; source: string }>;
    channel: { status: string; lastCheckState: string | null } | null;
    secrets: { whapi: boolean; model: boolean };
    messages: Array<{ direction: string; status: string; text: string; leadId: string | null }>;
    outbox: Record<string, number>;
    courses: Array<{ id: string; title: string }>;
};

/** Поддельные Whapi и OpenAI: запоминают вызовы, поведение задаёт тест */
function fakeNetwork() {
    const calls: Array<{ url: string; method: string; body: unknown; auth: string | null }> = [];
    const state = { health: "AUTH", sendOk: true, modelOk: true, modelText: "Доставка по городу — 1 день." };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, method: init?.method ?? "GET", body, auth: new Headers(init?.headers).get("authorization") });
        if (url.endsWith("/health")) return Response.json({ status: { code: 4, text: state.health } });
        if (url.endsWith("/settings")) return Response.json({ ok: true });
        if (url.endsWith("/messages/text")) return state.sendOk ? Response.json({ sent: true }) : new Response("down", { status: 503 });
        if (url.includes("api.openai.com")) return state.modelOk ? Response.json({ choices: [{ message: { content: state.modelText } }] }) : new Response("err", { status: 500 });
        throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    return { calls, state, restore: () => (globalThis.fetch = original) };
}

async function setup(overrides: Record<string, string> = {}) {
    const env = createTestEnv({ WHAPI_TOKEN: "whapi-test-token", ...overrides });
    const director = await bootstrapDirector(env);
    const north = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север" })).body.branch.id;
    const south = (await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг" })).body.branch.id;
    const manager = await invite(env, director, { role: "manager", branchId: north }, "north.manager", "Мария Руководитель");
    const southManager = await invite(env, director, { role: "manager", branchId: south }, "south.manager");
    const employee = await invite(env, manager, { role: "employee" }, "ivan", "Иван");
    return { env, director, manager, southManager, employee, north, south };
}

function hook(env: ReturnType<typeof createTestEnv>, token: string, body: unknown) {
    return handleApiRequest(new Request(`https://sales.example/api/whatsapp/webhook/${token}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.50.0.1" }, body: JSON.stringify(body) }), env);
}

const inbound = (id: string, phone: string, text: string, extra: Record<string, unknown> = {}) => ({ messages: [{ id, from_me: false, type: "text", chat_id: `${phone}@s.whatsapp.net`, from_name: "Айгерим", text: { body: text }, ...extra }] });

test("WhatsApp: права, агент из базового, материалы и импорт курса без ответов теста", async () => {
    const { env, director, manager, employee, north, south } = await setup();
    assert.equal((await employee.get("/api/whatsapp/studio")).status, 403, "сотруднику раздел закрыт");
    assert.equal((await manager.get(`/api/whatsapp/studio?branchId=${south}`)).status, 403, "чужой филиал руководителю закрыт");
    await director.put("/api/me/branch", { branchId: "*" });
    assert.equal((await director.get("/api/whatsapp/studio")).status, 400, "директору нужен один филиал");

    let studio = (await manager.get<Studio>("/api/whatsapp/studio")).body;
    assert.equal(studio.agent, null);
    assert.equal(studio.secrets.whapi, true);
    assert.equal(JSON.stringify(studio).includes("whapi-test-token"), false, "токен не уходит в браузер");
    assert.equal((await manager.post("/api/whatsapp/test", { question: "?" })).status, 409, "без агента теста нет");

    studio = (await manager.post<Studio>("/api/whatsapp/agent", {})).body;
    assert.equal(studio.agent?.name, "Помощник");
    studio = (await manager.post<Studio>("/api/whatsapp/agent", {})).body;
    assert.equal(Number((env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM wa_agents").get() as { n: number }).n), 1, "повтор не создаёт второго агента");
    const updated = await manager.patch<Studio>("/api/whatsapp/agent", { name: "Айла", instructions: "Отвечай кратко и вежливо." });
    assert.equal(updated.body.agent?.name, "Айла");

    assert.equal((await manager.post("/api/whatsapp/materials", { title: "", body: "x" })).status, 400);
    studio = (await manager.post<Studio>("/api/whatsapp/materials", { title: "Доставка", body: "Доставка по городу занимает 1 день.\n\nСамовывоз бесплатно." })).body;
    assert.equal(studio.materials.length, 1);

    await integration(env, "POST", "/api/integration/training/courses/sales-basics/versions", {
        approved: true,
        title: "Основы продаж",
        externalRef: "rev-1",
        lessons: [{ key: "intro", title: "Гарантия", body: "Гарантия на товары — 12 месяцев." }],
        test: { passPercent: 80, questions: [{ key: "q1", text: "Секретный вопрос теста", kind: "single", options: [{ key: "a", text: "Правильный-ответ-XYZ" }, { key: "b", text: "B" }], correct: ["a"] }] },
    });
    studio = (await manager.get<Studio>("/api/whatsapp/studio")).body;
    studio = (await manager.post<Studio>("/api/whatsapp/materials", { courseId: studio.courses[0]!.id })).body;
    assert.equal(studio.materials[1]!.source, "course");
    const stored = env.DB.sqlite.prepare("SELECT body FROM wa_materials WHERE source = 'course'").get() as { body: string };
    assert.match(stored.body, /12 месяцев/);
    assert.doesNotMatch(stored.body, /Правильный-ответ-XYZ|Секретный вопрос/, "ответы теста агенту не передаются");

    const other = await director.put("/api/me/branch", { branchId: north });
    assert.equal(other.status, 200);
    const material = studio.materials[0]!;
    const removed = await director.request<Studio>("DELETE", `/api/whatsapp/materials/${material.id}`);
    assert.equal(removed.body.materials.length, 1);
});

test("WhatsApp: тестовый диалог офлайн и с моделью; ключ модели не раскрывается", async () => {
    const net = fakeNetwork();
    try {
        const offline = await setup();
        await offline.manager.post("/api/whatsapp/agent", {});
        await offline.manager.post("/api/whatsapp/materials", { title: "Доставка", body: "Доставка по городу занимает 1 день.\n\nОплата при получении." });
        const answer = await offline.manager.post<{ reply: string; mode: string }>("/api/whatsapp/test", { question: "Сколько идёт доставка?" });
        assert.equal(answer.body.mode, "offline");
        assert.match(answer.body.reply, /1 день/);
        const unknown = await offline.manager.post<{ reply: string }>("/api/whatsapp/test", { question: "Какая зарплата у менеджера Марии?" });
        assert.match(unknown.body.reply, /передам ваш вопрос менеджеру/, "вне материалов — передача менеджеру");
        assert.equal(net.calls.filter((call) => call.url.includes("openai")).length, 0, "без ключа модель не вызывается");

        const online = await setup({ OPENAI_API_KEY: "sk-test-key" });
        await online.manager.post("/api/whatsapp/agent", {});
        await online.manager.post("/api/whatsapp/materials", { title: "Доставка", body: "Доставка по городу занимает 1 день." });
        const model = await online.manager.post<{ reply: string; mode: string }>("/api/whatsapp/test", { question: "Доставка?" });
        assert.deepEqual([model.body.mode, model.body.reply], ["model", "Доставка по городу — 1 день."]);
        const request = net.calls.find((call) => call.url.includes("openai"))!;
        assert.equal(request.auth, "Bearer sk-test-key");
        const prompt = JSON.stringify(request.body);
        assert.match(prompt, /Доставка по городу/);
        assert.doesNotMatch(prompt, /Мария Руководитель|Иван/, "данные компании модели не передаются");
        let studio = (await online.manager.get<Studio>("/api/whatsapp/studio")).body;
        assert.deepEqual([studio.agent?.lastTest?.ok, studio.agent?.lastTest?.mode], [true, "model"]);
        assert.equal(JSON.stringify(studio).includes("sk-test-key"), false);

        net.state.modelOk = false;
        const fallback = await online.manager.post<{ reply: string; mode: string; error: string }>("/api/whatsapp/test", { question: "Доставка по городу?" });
        assert.equal(fallback.body.mode, "offline", "сбой модели — ответ по материалам");
        studio = (await online.manager.get<Studio>("/api/whatsapp/studio")).body;
        assert.equal(studio.agent?.lastTest?.ok, false, "результат последней проверки записан");
    } finally {
        net.restore();
    }
});

test("WhatsApp: подключение номера, webhook, лид из незнакомого номера, дедупликация, повтор отправки", async () => {
    const net = fakeNetwork();
    try {
        const { env, manager, southManager, director, employee } = await setup();
        await manager.post("/api/whatsapp/agent", {});
        await manager.post("/api/whatsapp/materials", { title: "Доставка", body: "Доставка по городу занимает 1 день." });

        net.state.health = "QR";
        const connected = await manager.post<Studio>("/api/whatsapp/channel/connect", { phone: "+7 700 000 00 01" });
        assert.equal(connected.status, 200);
        assert.deepEqual([connected.body.channel?.status, connected.body.channel?.lastCheckState], ["connected", "qr"], "реальное состояние номера показано отдельно");
        const hookUrl = (net.calls.find((call) => call.url.endsWith("/settings"))!.body as { webhooks: Array<{ url: string }> }).webhooks[0]!.url;
        const token = hookUrl.split("/").pop()!;
        assert.equal(JSON.stringify(connected.body).includes(token), false, "секрет webhook не показывается");
        const storedHash = (env.DB.sqlite.prepare("SELECT webhook_token_hash AS h FROM wa_channels").get() as { h: string }).h;
        assert.notEqual(storedHash, token, "в БД только хэш секрета");
        assert.equal((await southManager.post("/api/whatsapp/agent", {})).status, 200);
        assert.equal((await southManager.post("/api/whatsapp/channel/connect", {})).status, 409, "один токен — один номер");

        net.state.health = "AUTH";
        const checked = await manager.post<Studio>("/api/whatsapp/channel/check", {});
        assert.equal(checked.body.channel?.lastCheckState, "connected");

        assert.equal((await hook(env, "wrong-token-wrong-token-1234", inbound("m0", "77011112233", "Привет"))).status, 404, "неверный секрет отклоняется");

        const first = await hook(env, token, inbound("m1", "77011112233", "Сколько идёт доставка?"));
        assert.equal(first.status, 200);
        const sent = net.calls.filter((call) => call.url.endsWith("/messages/text"));
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0]!.body, { to: "77011112233@s.whatsapp.net", body: "Доставка по городу занимает 1 день." });
        assert.doesNotMatch(JSON.stringify(sent[0]!.body), /Мария|Иван|Север/, "незнакомый номер получает только ответ агента");

        const lead = env.DB.sqlite.prepare("SELECT id, source, owner_user_id AS owner, client_phone AS phone, client_name AS name, stage FROM leads").get() as Record<string, unknown>;
        assert.deepEqual([lead["source"], lead["owner"], lead["phone"], lead["name"], lead["stage"]], ["whatsapp", null, "+77011112233", "Айгерим", "new"], "лид без ответственного");

        await hook(env, token, inbound("m1", "77011112233", "Сколько идёт доставка?"));
        assert.equal(Number((env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM wa_messages WHERE direction='in'").get() as { n: number }).n), 1, "повторная доставка не создаёт дубль");
        await hook(env, token, inbound("m2", "77011112233", "А самовывоз?"));
        assert.equal(Number((env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }).n), 1, "тот же номер — тот же лид");
        await hook(env, token, { messages: [{ id: "g1", from_me: false, type: "text", chat_id: "120363@g.us", text: { body: "группа" } }, { id: "me1", from_me: true, type: "text", chat_id: "77011112233@s.whatsapp.net", text: { body: "наше" } }] });
        assert.equal(Number((env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM wa_messages WHERE direction='in'").get() as { n: number }).n), 2, "группы и свои сообщения пропускаются");

        const crm = await manager.get<{ leads: Array<{ source: string; ownerUserId: string | null }> }>("/api/crm/leads");
        assert.deepEqual(crm.body.leads.map((item) => [item.source, item.ownerUserId]), [["whatsapp", null]], "лид виден в CRM филиала");
        await director.put("/api/me/branch", { branchId: "*" });
        void employee;

        net.state.sendOk = false;
        await hook(env, token, inbound("m3", "77019998877", "Доставка?"));
        let studio = (await manager.get<Studio>("/api/whatsapp/studio")).body;
        assert.equal(studio.outbox["failed"], 1, "ошибка отправки записана");
        net.state.sendOk = true;
        const later = Date.now() + 5 * 60_000;
        const retried = await retryPending(env, later, { minAgeMs: 60_000 });
        assert.deepEqual(retried, { sent: 1, failed: 0 }, "повтор по расписанию отправляет");
        studio = (await manager.get<Studio>("/api/whatsapp/studio")).body;
        assert.equal(studio.outbox["failed"] ?? 0, 0);
        assert.equal(net.calls.filter((call) => call.url.endsWith("/messages/text")).length, 4);

        const off = await manager.post<Studio>("/api/whatsapp/channel/disconnect", {});
        assert.equal(off.body.channel?.status, "disconnected");
        assert.equal((await hook(env, token, inbound("m9", "77011112233", "Привет"))).status, 404, "после отключения старый адрес не работает");
    } finally {
        net.restore();
    }
});

test("WhatsApp: агент без ключа выбирает подходящий абзац, подсказка модели содержит правила", () => {
    const materials = [
        { title: "Оплата", body: "Оплата картой на сайте не принимается.\n\nОплата наличными при получении." },
        { title: "Доставка", body: "Доставка по городу занимает 1 день." },
    ];
    assert.match(offlineAnswer("как с доставкой по городу", materials), /1 день/);
    assert.match(offlineAnswer("сколько стоит луна", materials), /менеджеру/);
    const prompt = systemPrompt("Помощник", "Будь вежлив.", materials);
    assert.match(prompt, /только на основе разрешённых материалов/);
    assert.match(prompt, /### Доставка/);
});
