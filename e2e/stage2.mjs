import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапа 2 (обучение) в браузере. Запуск на чистой БД:
//   npm run dev  →  node e2e/stage2.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OWNER_CODE = process.env.OWNER_CODE ?? "local-owner-code";
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };
const H = { "x-asc-request": "1" };

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1440, height: 900 }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  const reload = p.reload.bind(p);
  p.reload = async (...a) => { const r = await reload(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const token = (path) => path.split("/").pop();

const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();
const program = (title, right) => ({
  title, description: "Короткое обучение перед работой.", passPercent: 100,
  lessons: [{ title: "Наш клиент", body: "Клиенты — кафе и магазины.\n\nЗвоним в течение часа.", minutes: 5 }],
  questions: [1, 2].map((n) => ({ text: `Вопрос ${n}: выберите вариант ${right === 0 ? "A" : "B"}`, options: ["Вариант A", "Вариант B"], correct: [right] })),
});

// Подготовка: компания, директор, филиал, два новых сотрудника (телефон)
const dir = await ctx();
const issued = await api(dir.c, "POST", "/api/owner/activation-links", { code: OWNER_CODE, companyName: "Демо" });
await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Айгерим Директорова", login: "aigerim", password: "director-pass-1" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Север" })).branch;
async function employee(name, login) {
  const inv = await api(dir.c, "POST", "/api/invitations", { role: "employee", branchId: branch.id });
  const e = await ctx({ ...devices["iPhone 13"] });
  await api(e.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: name, login, password: "employee-pass-1" });
  return e;
}
const emp = await employee("Константин Длиннофамильный-Сотрудниковский", "kostya");
const second = await employee("Ольга Новенькая", "olga");
log("ok: подготовлены директор, филиал, два сотрудника");

// Директор: программа на сайте — правка названия и проходного балла, сохранение Ctrl+Enter
await dir.p.goto(BASE + "/training?tab=program");
await dir.p.getByLabel("Название", { exact: true }).waitFor();
assert((await dir.p.getByLabel("Название", { exact: true }).inputValue()) === "Старт в компании", "стартовая программа создана сама");
await dir.p.screenshot({ path: SHOTS + "/s2-program-editor.png" });
await api(dir.c, "PUT", "/api/training/program", program("Основы продаж", 0));
await dir.p.reload();
await dir.p.getByLabel("Проходной балл, %").fill("100");
await dir.p.getByLabel("Название", { exact: true }).fill("Основы продаж — 2026");
await dir.p.keyboard.press("Control+Enter");
await dir.p.getByText(/Программа сохранена\. Версия 3/).waitFor();
log("ok: директор правит программу на сайте, сохраняется новая версия");

// Сотрудник на телефоне: до теста открыто только обучение
await emp.p.goto(BASE + "/");
await emp.p.waitForURL("**/training");
await emp.p.getByText("Откроется после теста").waitFor();
assert((await emp.c.request.get(BASE + "/api/crm/leads")).status() === 403, "рабочее место закрыто до теста");
await emp.p.screenshot({ path: SHOTS + "/s2-employee-start-mobile.png", fullPage: true });
await emp.p.getByRole("link", { name: "Открыть уроки" }).click();
await emp.p.getByText("Звоним в течение часа.").waitFor();
await emp.p.getByRole("button", { name: "Урок пройден" }).first().click();
await emp.p.getByText("Уроки: 1 из 1").waitFor();
log("ok: урок отмечен");

// Второй сотрудник начинает тест — и в это время выходит новая версия программы
await second.p.goto(BASE + "/training");
await second.p.getByRole("link", { name: "Пройти тест" }).click();
await second.p.waitForURL(/attempt=/);
await second.p.getByText("Вопрос 1: выберите вариант A").waitFor();
await api(dir.c, "PUT", "/api/training/program", program("Основы продаж — 2026", 1));
await second.p.reload();
await second.p.getByText(/Этот тест начат по прежней версии программы/).waitFor();
assert(await second.p.getByText("Вопрос 1: выберите вариант A").isVisible(), "начатый тест завершается по своей версии");

// Сотрудник сдаёт тест по новой версии — рабочее место открывается
await emp.p.goto(BASE + "/training");
await emp.p.getByRole("link", { name: "Пройти тест" }).click();
await emp.p.getByText("Вопрос 1: выберите вариант B").waitFor();
const sets = emp.p.locator("fieldset");
for (let i = 0; i < 2; i++) await sets.nth(i).getByLabel("Вариант B").check();
await emp.p.getByText("Отвечено: 2 из 2").waitFor();
await emp.p.getByRole("button", { name: "Завершить тест" }).click();
await emp.p.getByText("Обучение пройдено. Рабочее место открыто.").waitFor();
await emp.p.screenshot({ path: SHOTS + "/s2-result-mobile.png" });
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Заявок пока нет").waitFor();
assert(!(await emp.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки на телефоне");
log("ok: после теста рабочее место открыто");

// Директор: прогресс команды и ручная отметка «Прошёл обучение»
await dir.p.goto(BASE + "/training");
await dir.p.locator("tr", { hasText: "Константин" }).getByText("Обучение пройдено").waitFor();
const olga = dir.p.locator("tr", { hasText: "Ольга" });
await olga.getByText("Проходит тест").waitFor();
await olga.getByLabel("Прошёл обучение").check();
await dir.p.locator("tr", { hasText: "Ольга" }).getByText("Обучение пройдено").waitFor();
await dir.p.screenshot({ path: SHOTS + "/s2-director-team.png" });
assert((await second.c.request.get(BASE + "/api/crm/config")).status() === 200, "отметка руководителя открывает рабочее место");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
