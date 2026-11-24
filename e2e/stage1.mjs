import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапа 1 в браузере (ПК и iPhone 13). Запуск на чистой БД:
//   npm run dev  →  node e2e/stage1.mjs [папка-для-снимков]
// Нужен установленный пакет playwright с Chromium.
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OWNER_CODE = process.env.OWNER_CODE ?? "local-owner-code";
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, ...opts });
  const p = await c.newPage();
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  const reload = p.reload.bind(p);
  p.reload = async (...a) => { const r = await reload(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { c, p };
}

// Владелец выпускает ссылку через UI
const owner = await ctx();
await owner.p.goto(BASE + "/owner");
await owner.p.getByLabel("Код активации владельца").fill("wrong-code");
await owner.p.getByRole("button", { name: "Выпустить ссылку" }).click();
await owner.p.getByText("Неверный код владельца.").first().waitFor();
log("ok: неверный код показан");
await owner.p.getByLabel("Код активации владельца").fill(OWNER_CODE);
await owner.p.keyboard.press("Control+Enter");
const linkInput = owner.p.locator("input[readonly]");
await linkInput.waitFor();
const activationUrl = await linkInput.inputValue();
assert(activationUrl.includes("/activate/"), "ссылка активации выпущена (Ctrl+Enter)");

// Директор активируется; ошибка формы не гасит ссылку
const dir = await ctx();
await dir.p.goto(activationUrl);
await dir.p.getByText("Активация директора").waitFor();
await dir.p.getByLabel("Ваше имя и фамилия").fill("Айгерим Директорова");
await dir.p.getByLabel("Придумайте логин").fill("aigerim");
await dir.p.getByLabel("Придумайте пароль").fill("short");
await dir.p.getByLabel("Повторите пароль").fill("short");
await dir.p.getByRole("button", { name: "Зарегистрироваться" }).click();
await dir.p.getByText("Пароль должен быть не короче 10 символов.").first().waitFor();
await dir.p.reload();
await dir.p.getByLabel("Ваше имя и фамилия").fill("Айгерим Директорова");
await dir.p.getByLabel("Придумайте логин").fill("aigerim");
await dir.p.getByLabel("Придумайте пароль").fill("director-pass-1");
await dir.p.getByLabel("Повторите пароль").fill("director-pass-1");
await dir.p.getByRole("button", { name: "Зарегистрироваться" }).click();
await dir.p.waitForURL("**/team"); await dir.p.waitForSelector("html[data-hydrated]");
assert(true, "директор активирован после ошибки формы, перешёл в «Команду»");

// Ссылка повторно не работает
const again = await ctx();
await again.p.goto(activationUrl);
await again.p.getByText("По этой ссылке уже зарегистрировались").waitFor();
log("ok: повторное открытие ссылки активации — «уже зарегистрировались»");

// Филиалы
await dir.p.getByRole("link", { name: "Филиалы" }).click();
await dir.p.getByText("Филиалов пока нет").waitFor();
for (const [name, city] of [["Север", "Астана"], ["Юг", "Алматы"]]) {
  await dir.p.getByRole("button", { name: "Добавить филиал" }).first().click();
  await dir.p.getByLabel("Название").fill(name);
  await dir.p.getByLabel(/Город/).fill(city);
  await dir.p.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await dir.p.getByRole("dialog").waitFor({ state: "detached" });
  await dir.p.locator("li", { hasText: name }).first().waitFor();
}
log("ok: созданы филиалы Север и Юг");
// Esc закрывает диалог, фокус возвращается
const addBtn = dir.p.getByRole("button", { name: "Добавить филиал" }).first();
await addBtn.click();
await dir.p.getByRole("dialog").waitFor();
await dir.p.keyboard.press("Escape");
await dir.p.getByRole("dialog").waitFor({ state: "detached" });
const focused = await dir.p.evaluate(() => document.activeElement?.textContent);
assert(focused === "Добавить филиал", "Esc закрыл диалог, фокус вернулся на кнопку");

// Выбор филиала в шапке
const branchSelect = dir.p.getByLabel("Филиал").first();
await branchSelect.selectOption({ label: "Север" });
await dir.p.waitForTimeout(300);

// Приглашение руководителя
await dir.p.getByRole("link", { name: "Команда" }).click();
await dir.p.getByRole("button", { name: "Пригласить" }).click();
const dialog = dir.p.getByRole("dialog");
await dialog.getByLabel("Роль").selectOption("manager");
await dialog.getByLabel(/Для кого/).fill("Руководитель Севера");
await dialog.getByRole("button", { name: "Создать" }).click();
const managerUrl = await dialog.locator("input[readonly]").inputValue();
assert(managerUrl.includes("/invite/"), "ссылка приглашения руководителя");
await dir.p.keyboard.press("Escape");

const mgr = await ctx();
await mgr.p.goto(managerUrl);
await mgr.p.getByText(/филиал «Север», роль: Руководитель филиала/).waitFor();
await mgr.p.getByLabel("Ваше имя и фамилия").fill("Бауыржан Руководителев");
await mgr.p.getByLabel("Придумайте логин").fill("baur.north");
await mgr.p.getByLabel("Придумайте пароль").fill("manager-pass-1");
await mgr.p.getByLabel("Повторите пароль").fill("manager-pass-1");
await mgr.p.keyboard.press("Control+Enter");
await mgr.p.waitForURL("**/team"); await mgr.p.waitForSelector("html[data-hydrated]");
log("ok: руководитель зарегистрирован по приглашению");

// Руководитель приглашает сотрудника
await mgr.p.getByRole("button", { name: "Пригласить" }).click();
const mdialog = mgr.p.getByRole("dialog");
assert(await mdialog.getByLabel("Роль").isDisabled(), "руководитель приглашает только сотрудников");
await mdialog.getByRole("button", { name: "Создать" }).click();
const employeeUrl = await mdialog.locator("input[readonly]").inputValue();
await mgr.p.keyboard.press("Escape");

// Сотрудник на телефоне
const emp = await ctx({ ...devices["iPhone 13"] });
await emp.p.goto(employeeUrl);
await emp.p.getByLabel("Ваше имя и фамилия").fill("Константин Длиннофамильный-Сотрудниковский");
await emp.p.getByLabel("Придумайте логин").fill("kostya");
await emp.p.getByLabel("Придумайте пароль").fill("employee-pass-1");
await emp.p.getByLabel("Повторите пароль").fill("employee-pass-1");
await emp.p.getByRole("button", { name: "Зарегистрироваться" }).click();
await emp.p.waitForURL("**/training"); await emp.p.waitForSelector("html[data-hydrated]");
await emp.p.getByText("Доступ к CRM и KPI откроется после допуска").waitFor();
await emp.p.getByRole("button", { name: "Меню" }).click();
const navLinks = await emp.p.locator("#mobile-nav nav a").allTextContents();
assert(JSON.stringify(navLinks) === JSON.stringify(["Обучение", "Профиль"]), "до допуска в меню только Обучение и Профиль: " + navLinks);
await emp.p.screenshot({ path: SHOTS + "/employee-mobile-before.png" });
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Раздел недоступен для вашей роли или до допуска.").waitFor();
log("ok: прямая ссылка на CRM до допуска — отказ");

// Руководитель выдаёт допуск
await mgr.p.reload();
await mgr.p.locator("li", { hasText: "Константин" }).getByRole("button", { name: "Выдать допуск" }).click();
await mgr.p.getByRole("dialog").getByRole("button", { name: "Выдать допуск" }).click();
await mgr.p.locator("li", { hasText: "Константин" }).getByText("Допущен").waitFor();
log("ok: допуск выдан");
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Раздел появится на следующем этапе").waitFor();
log("ok: после допуска CRM открыт со следующего запроса");

// Директор на телефоне: выбор филиала в шапке
const dirMobile = await ctx({ ...devices["iPhone 13"] });
await dirMobile.p.goto(BASE + "/login");
await dirMobile.p.getByLabel("Логин").fill("aigerim");
await dirMobile.p.getByLabel("Пароль").fill("director-pass-1");
await dirMobile.p.getByRole("button", { name: "Войти" }).click();
await dirMobile.p.waitForURL("**/team"); await dirMobile.p.waitForSelector("html[data-hydrated]");
const mobileSelect = dirMobile.p.getByLabel("Филиал").first();
await mobileSelect.waitFor(); assert(await mobileSelect.isVisible(), "выбор филиала в шапке на телефоне");
const options = await mobileSelect.locator("option").allTextContents();
assert(options.includes("Все филиалы") && options.includes("Юг"), "варианты: " + options.join(", "));
await dirMobile.p.screenshot({ path: SHOTS + "/director-mobile-team.png" });
await dir.p.reload();
await dir.p.locator("li", { hasText: "Константин" }).first().waitFor();
await dir.p.screenshot({ path: SHOTS + "/director-desktop-team.png" });

// Горизонтальной прокрутки на телефоне нет
const overflow = await emp.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert(!overflow, "нет горизонтальной прокрутки на телефоне");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
