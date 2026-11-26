import { readFileSync } from "node:fs";
import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапа 7 (WhatsApp Studio). Запуск на чистой БД:
//   npm run dev  →  node e2e/stage7.mjs [папка-для-снимков]
// Без WHAPI_TOKEN и OPENAI_API_KEY: агент отвечает офлайн, номер показан как «токен не задан».
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const OWNER_CODE = process.env.OWNER_CODE ?? vars.OWNER_ACTIVATION_CODE;
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };
const H = { "x-asc-request": "1" };
const token = (path) => path.split("/").pop();

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1600, height: 1000 }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();

const dir = await ctx();
const issued = await api(dir.c, "POST", "/api/owner/activation-links", { code: OWNER_CODE, companyName: "Демо: пекарни «Колос»" });
await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Анна Директорова", login: "director", password: "director-pass-1" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Центральная пекарня" })).branch;
const inv = await api(dir.c, "POST", "/api/invitations", { role: "manager", branchId: branch.id });
const mgr = await ctx();
await api(mgr.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: "Мария Руководитель", login: "manager", password: "secret-pass-1" });
const empInv = await api(dir.c, "POST", "/api/invitations", { role: "employee", branchId: branch.id });
const emp = await ctx({ ...devices["iPhone 13"] });
await api(emp.c, "POST", `/api/invitations/by-token/${token(empInv.path)}/accept`, { displayName: "Иван Пекарев", login: "ivan", password: "secret-pass-1" });
// Курс для импорта в материалы
const published = await (await dir.c.request.fetch(BASE + "/api/integration/training/courses/sales-basics/versions", {
  method: "POST",
  headers: { authorization: `Bearer ${vars.INTEGRATION_TOKEN}` },
  data: { approved: true, title: "Основы продаж", externalRef: "rev-1", lessons: [{ key: "g", title: "Гарантия", body: "Гарантия на торты и выпечку — 24 часа с момента покупки." }], test: { passPercent: 80, questions: [{ key: "q", text: "Секретный вопрос", kind: "single", options: [{ key: "a", text: "Секретный-ответ" }, { key: "b", text: "B" }], correct: ["a"] }] } },
})).json();
assert(published.version === 1, "курс опубликован через интеграцию");

// Руководитель: агент из базового, материалы, тестовый диалог
await mgr.p.goto(BASE + "/whatsapp");
await mgr.p.getByText("Агент филиала ещё не создан").waitFor();
await mgr.p.getByRole("button", { name: "Создать агента из базового" }).click();
await mgr.p.getByLabel("Имя агента").waitFor();
assert((await mgr.p.getByLabel("Имя агента").inputValue()) === "Помощник", "агент создан копией базового");
await mgr.p.getByText("Офлайн-режим: ответ по материалам без модели").first().waitFor();
assert(await mgr.p.getByText("Ключ модели (OPENAI_API_KEY) не задан").isVisible(), "без ключа модели показан офлайн-режим и причина");

await mgr.p.getByLabel("Имя агента").fill("Айла");
await mgr.p.keyboard.press("Control+Enter");
await mgr.p.getByText("Сохранено.").waitFor();
log("ok: агент переименован (Ctrl+Enter)");

await mgr.p.getByRole("button", { name: "Добавить текст" }).click();
await mgr.p.getByLabel("Название").fill("Доставка");
await mgr.p.getByLabel("Текст материала").fill("Доставка по городу занимает 1 день, бесплатно от 10 000 ₸.\n\nСамовывоз из пекарни на Абая, 10.");
await mgr.p.getByRole("dialog").getByRole("button", { name: "Добавить материал" }).click();
await mgr.p.getByText("Разрешённые материалы · 1").waitFor();
await mgr.p.getByRole("button", { name: "Из курса обучения" }).click();
await mgr.p.getByRole("dialog").getByRole("button", { name: "Добавить материал" }).click();
await mgr.p.getByText("Разрешённые материалы · 2").waitFor();
assert(await mgr.p.getByText("Основы продаж (ред. 1)").isVisible(), "материал импортирован из курса");
assert(!(await mgr.p.getByText("Секретный-ответ").count()), "ответы теста в материалы не попали");

const chat = mgr.p.getByLabel("Сообщение");
const bubbles = (page) => page.locator('[aria-label="Тестовый диалог"][aria-live]');
await chat.fill("Сколько идёт доставка по городу?");
await chat.press("Enter");
await bubbles(mgr.p).getByText("Доставка по городу занимает 1 день", { exact: false }).last().waitFor();
await chat.fill("Какая гарантия на торты?");
await chat.press("Enter");
await bubbles(mgr.p).getByText("24 часа с момента покупки", { exact: false }).last().waitFor();
await chat.fill("Сколько зарабатывает Мария?");
await chat.press("Enter");
await bubbles(mgr.p).getByText("передам ваш вопрос менеджеру", { exact: false }).last().waitFor();
log("ok: тестовый диалог отвечает по материалам, вне материалов — передача менеджеру");
await mgr.p.getByText(/Проверка пройдена/).waitFor();
log("ok: результат последней проверки агента показан в карточке");
await mgr.p.screenshot({ path: SHOTS + "/s7-agent.png", fullPage: true });

// Рабочий номер: без токена — состояние и способ восстановления
await mgr.p.getByRole("tab", { name: "Рабочий номер" }).click();
await mgr.p.getByText("Токен Whapi не задан").first().waitFor();
assert(await mgr.p.getByText(/Как восстановить: владелец сайта задаёт секрет WHAPI_TOKEN/).isVisible(), "показан способ восстановления канала");
assert(await mgr.p.getByRole("button", { name: "Подключить номер" }).isDisabled(), "без токена подключение недоступно");
await mgr.p.screenshot({ path: SHOTS + "/s7-channel.png", fullPage: true });
await mgr.p.getByRole("tab", { name: "Журнал сообщений" }).click();
await mgr.p.getByText("Сообщений пока нет").waitFor();
log("ok: журнал пуст до подключения номера");

// Директор: «Все филиалы» → просьба выбрать филиал; выбран филиал → тот же агент
await api(dir.c, "POST", "/api/branches", { name: "Пекарня на Сейфуллина" });
await api(dir.c, "PUT", "/api/me/branch", { branchId: "*" });
await dir.p.goto(BASE + "/whatsapp");
await dir.p.getByText("агент и номер настраиваются для каждого филиала").waitFor();
await api(dir.c, "PUT", "/api/me/branch", { branchId: branch.id });
await dir.p.goto(BASE + "/whatsapp");
assert((await dir.p.getByLabel("Имя агента").inputValue()) === "Айла", "директор видит агента выбранного филиала");

// Сотрудник: раздел закрыт, в меню его нет (телефон)
await emp.p.goto(BASE + "/whatsapp");
await emp.p.getByText(/недоступен|нет доступа/i).first().waitFor();
assert((await (await emp.c.request.get(BASE + "/api/whatsapp/studio")).status()) === 403, "сотруднику студия недоступна на сервере");

// Телефон: руководитель на iPhone — чат помещается без горизонтальной прокрутки
const phone = await ctx({ ...devices["iPhone 13"] });
await api(phone.c, "POST", "/api/auth/login", { login: "manager", password: "secret-pass-1" });
await phone.p.goto(BASE + "/whatsapp");
await phone.p.getByLabel("Сообщение").waitFor();
assert(!(await phone.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки на телефоне");
await phone.p.getByLabel("Сообщение").fill("Самовывоз есть?");
await phone.p.getByRole("button", { name: "Отправить" }).click();
await bubbles(phone.p).getByText("Абая, 10", { exact: false }).last().waitFor();
await phone.p.screenshot({ path: SHOTS + "/s7-phone.png", fullPage: true });
log("ok: тестовый диалог работает на телефоне");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
