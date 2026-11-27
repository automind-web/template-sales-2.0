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
const hydrated = (p) => p.waitForSelector("html[data-hydrated]");

async function register(p, url, name, login, password) {
  await p.goto(url);
  await p.getByLabel("Имя и фамилия").fill(name);
  await p.getByLabel("Логин").fill(login);
  await p.getByLabel("Пароль", { exact: true }).fill(password);
  await p.getByLabel("Повторите пароль").fill(password);
  await p.getByRole("button", { name: "Зарегистрироваться" }).click();
}

// Владелец: активация компании
const owner = await ctx();
await owner.p.goto(BASE + "/owner");
await owner.p.getByRole("heading", { name: "Активация компании" }).waitFor();
await owner.p.screenshot({ path: SHOTS + "/s1-owner.png" });
await owner.p.getByLabel("Код владельца").fill("wrong-code");
await owner.p.getByRole("button", { name: "Выпустить приглашение" }).click();
await owner.p.getByText("Неверный код владельца.").first().waitFor();
log("ok: неверный код показан");
await owner.p.getByLabel("Код владельца").fill(OWNER_CODE);
await owner.p.keyboard.press("Control+Enter");
const activationUrl = await owner.p.locator("input[readonly]").inputValue();
assert(activationUrl.includes("/activate/"), "приглашение директора выпущено (Ctrl+Enter)");

// Директор: ошибка формы не гасит ссылку
const dir = await ctx();
await register(dir.p, activationUrl, "Айгерим Директорова", "aigerim", "short");
await dir.p.getByText("Пароль должен быть не короче 10 символов.").first().waitFor();
await register(dir.p, activationUrl, "Айгерим Директорова", "aigerim", "director-pass-1");
await dir.p.waitForURL(BASE + "/"); await hydrated(dir.p);
await dir.p.getByText("Первые шаги").waitFor();
await dir.p.screenshot({ path: SHOTS + "/s1-home-setup.png" });
await dir.p.getByRole("link", { name: /Создайте филиал/ }).click();
await dir.p.waitForURL("**/settings?tab=branches"); await hydrated(dir.p);
assert(true, "директор активирован после ошибки формы, на главной — первые шаги, переход к филиалам");

const again = await ctx();
await again.p.goto(activationUrl);
await again.p.getByText("По этой ссылке уже зарегистрировались").waitFor();
log("ok: повторное открытие ссылки — «уже зарегистрировались»");

// Филиалы
await dir.p.getByText("Создайте первый филиал").waitFor();
for (const [name, city] of [["Пекарня на Северной", "Астана"], ["Центральная пекарня", "Алматы"]]) {
  await dir.p.getByRole("button", { name: /Новый филиал/ }).click();
  const d = dir.p.getByRole("dialog");
  await d.getByLabel("Название").fill(name);
  await d.getByLabel(/Город/).fill(city);
  await d.getByRole("button", { name: /Создать/ }).click();
  await d.waitFor({ state: "detached" });
  await dir.p.locator("main").getByText(name, { exact: true }).waitFor();
}
log("ok: созданы два филиала");
const addBtn = dir.p.getByRole("button", { name: /Новый филиал/ });
await addBtn.click();
await dir.p.getByRole("dialog").waitFor();
await dir.p.keyboard.press("Escape");
await dir.p.getByRole("dialog").waitFor({ state: "detached" });
assert((await dir.p.evaluate(() => document.activeElement?.textContent ?? "")).includes("Новый филиал"), "Esc закрыл диалог, фокус вернулся на кнопку");
await dir.p.screenshot({ path: SHOTS + "/s1-settings-branches.png" });

// Выбор филиала в шапке и приглашение руководителя
await dir.p.getByLabel("Филиал", { exact: true }).first().selectOption({ label: "Центральная пекарня" });
await dir.p.waitForTimeout(400);
await dir.p.getByRole("tab", { name: "Приглашения" }).click();
await dir.p.getByLabel("Роль").selectOption("manager");
await dir.p.getByLabel("Кому (подсказка имени)").fill("Мария Руководитель");
await dir.p.getByRole("button", { name: /Создать ссылку/ }).click();
const managerUrl = await dir.p.locator("input[readonly]").inputValue();
assert(managerUrl.includes("/invite/"), "ссылка приглашения руководителя");
await dir.p.getByText("действует до").first().waitFor();

const mgr = await ctx();
await mgr.p.goto(managerUrl);
await mgr.p.getByText("Центральная пекарня · Руководитель филиала").waitFor();
await register(mgr.p, managerUrl, "Мария Руководитель", "maria", "manager-pass-1");
await mgr.p.waitForURL(BASE + "/"); await hydrated(mgr.p);
await mgr.p.getByText("Дела на сегодня").waitFor();
log("ok: руководитель зарегистрирован и видит главную");

// Руководитель: в настройках только участники и приглашения своего филиала
await mgr.p.getByRole("link", { name: "Настройки системы" }).click();
await mgr.p.getByRole("tab", { name: "Сотрудники" }).waitFor();
const tabs = await mgr.p.getByRole("tab").allTextContents();
assert(JSON.stringify(tabs) === JSON.stringify(["Сотрудники", "Приглашения"]), "вкладки руководителя: " + tabs.join(", "));
await mgr.p.getByRole("tab", { name: "Приглашения" }).click();
assert(await mgr.p.getByLabel("Роль").isDisabled(), "руководитель приглашает только сотрудников");
await mgr.p.getByLabel("Кому (подсказка имени)").fill("Новый сотрудник");
await mgr.p.keyboard.press("Control+Enter");
const employeeUrl = await mgr.p.locator("input[readonly]").inputValue();

// Сотрудник на телефоне
const emp = await ctx({ ...devices["iPhone 13"] });
await register(emp.p, employeeUrl, "Константин Длиннофамильный-Сотрудниковский", "kostya", "employee-pass-1");
await emp.p.waitForURL("**/training"); await hydrated(emp.p);
await emp.p.getByText("Откроется после теста").waitFor();
await emp.p.screenshot({ path: SHOTS + "/s1-employee-mobile.png" });
await emp.p.getByRole("button", { name: "Меню" }).click();
const navLinks = (await emp.p.locator("#mobile-nav nav ul").first().locator("li").allTextContents()).map((text) => text.replace("Откроется после обучения", "").trim());
assert(JSON.stringify(navLinks) === JSON.stringify(["Обучение", "CRM", "KPI"]), "до теста открыто только обучение, CRM и KPI видны закрытыми: " + navLinks);
assert((await emp.p.locator("#mobile-nav nav a", { hasText: "CRM" }).count()) === 0, "CRM в меню без ссылки");
await emp.p.screenshot({ path: SHOTS + "/s1-employee-mobile-menu.png" });
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Раздел откроется после обучения или недоступен для вашей роли.").waitFor();
log("ok: прямая ссылка на CRM до допуска — отказ");

// Руководитель выдаёт допуск флажком в таблице участников
await mgr.p.getByRole("tab", { name: "Сотрудники" }).click();
const row = mgr.p.locator("tr", { hasText: "Константин" });
await row.getByLabel("Прошёл обучение").click();
await mgr.p.waitForFunction(() => !document.querySelector("tr input[disabled][type=checkbox]"));
await mgr.p.waitForTimeout(500);
await mgr.p.reload();
assert(await mgr.p.locator("tr", { hasText: "Константин" }).getByLabel("Прошёл обучение").isChecked(), "отметка «Прошёл обучение» сохранена");
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Заявок пока нет").waitFor();
log("ok: после отметки руководителя рабочее место открыто");
assert(!(await emp.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки на телефоне");

// Директор на телефоне: выбор филиала в шапке
const dirMobile = await ctx({ ...devices["iPhone 13"] });
await dirMobile.p.goto(BASE + "/login");
await dirMobile.p.getByLabel("Логин").fill("aigerim");
await dirMobile.p.getByLabel("Пароль").fill("director-pass-1");
await dirMobile.p.getByRole("button", { name: "Войти" }).click();
await dirMobile.p.waitForURL(BASE + "/"); await hydrated(dirMobile.p);
const mobileSelect = dirMobile.p.getByLabel("Филиал", { exact: true }).first();
await mobileSelect.waitFor();
const options = await mobileSelect.locator("option").allTextContents();
assert(options.includes("Все филиалы") && options.includes("Пекарня на Северной"), "филиал в шапке на телефоне: " + options.join(", "));

// Снимки экранов директора
await dir.p.getByRole("tab", { name: "Сотрудники" }).click();
await dir.p.locator("tr", { hasText: "Константин" }).waitFor();
await dir.p.screenshot({ path: SHOTS + "/s1-settings-members.png" });
await dir.p.getByRole("tab", { name: "Приглашения" }).click();
await dir.p.getByText("использовано").first().waitFor();
await dir.p.screenshot({ path: SHOTS + "/s1-settings-invitations.png" });
await dir.p.getByRole("tab", { name: "Воронка продаж" }).click();
await dir.p.getByText("Этапы сделки").first().waitFor();
await dir.p.screenshot({ path: SHOTS + "/s1-settings-funnel.png" });
await dir.p.getByRole("tab", { name: "Компания" }).click();
await dir.p.getByLabel("Название компании").waitFor();
await dir.p.screenshot({ path: SHOTS + "/s1-settings-company.png" });
await dir.p.locator("aside").getByRole("link", { name: /Профиль/ }).click();
await dir.p.getByText("Личные данные").waitFor();
await dir.p.getByLabel("Имя", { exact: true }).fill("Айгерим Директорова-Новая");
await dir.p.getByRole("button", { name: "Сохранить" }).first().click();
await dir.p.locator("aside").getByText("Айгерим Директорова-Новая").waitFor();
await dir.p.waitForTimeout(400);
await dir.p.screenshot({ path: SHOTS + "/s1-profile.png", fullPage: true });
log("ok: имя в профиле сохранено");

await again.p.goto(BASE + "/login");
await again.p.screenshot({ path: SHOTS + "/s1-login.png" });

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
