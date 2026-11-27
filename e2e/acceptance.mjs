import { readFileSync } from "node:fs";
import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Приёмка: полный путь через интерфейс на ПК и телефоне. Запуск на чистой БД:
//   npm run dev  →  node e2e/acceptance.mjs [папка-для-снимков]
// Владелец → директор → филиал → руководитель → сотрудник (телефон) → обучение → допуск →
// лид → смена этапа → руководитель видит изменение в отчёте и открывает исходную сделку.
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1440, height: 950 }, ...opts });
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
const noHorizontalScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function register(p, url, name, login, password) {
  await p.goto(url);
  await p.getByLabel("Имя и фамилия").fill(name);
  await p.getByLabel("Логин").fill(login);
  await p.getByLabel("Пароль", { exact: true }).fill(password);
  await p.getByLabel("Повторите пароль").fill(password);
  await p.getByRole("button", { name: "Зарегистрироваться" }).click();
}

// 1. Владелец сайта: код владельца (OWNER_ACTIVATION_CODE) → ссылка активации директора
const owner = await ctx();
await owner.p.goto(BASE + "/owner");
await owner.p.getByLabel("Код владельца").fill(vars.OWNER_ACTIVATION_CODE);
await owner.p.getByLabel("Название компании").fill("Пекарни «Колос»");
await owner.p.keyboard.press("Control+Enter");
const activationUrl = await owner.p.locator("input[readonly]").inputValue();
assert(activationUrl.includes("/activate/"), "владелец выпустил ссылку активации директора (/owner)");

// 2. Директор: регистрация, филиал, приглашение руководителя
const dir = await ctx();
await register(dir.p, activationUrl, "Анна Директорова", "director", "director-pass-1");
await dir.p.waitForURL(BASE + "/"); await hydrated(dir.p);
await dir.p.getByText("Первые шаги").waitFor();
await dir.p.getByRole("link", { name: /Создайте филиал/ }).click();
await dir.p.waitForURL("**/settings?tab=branches"); await hydrated(dir.p);
await dir.p.getByRole("button", { name: /Новый филиал/ }).click();
await dir.p.getByRole("dialog").getByLabel("Название").fill("Центральная пекарня");
await dir.p.getByRole("dialog").getByRole("button", { name: /Создать/ }).click();
await dir.p.locator("main").getByText("Центральная пекарня", { exact: true }).waitFor();
log("ok: директор активирован и создал филиал");
await dir.p.getByRole("tab", { name: "Приглашения" }).click();
await dir.p.getByLabel("Роль").selectOption("manager");
await dir.p.getByLabel("Кому (подсказка имени)").fill("Мария Руководитель");
await dir.p.keyboard.press("Control+Enter");
const managerUrl = await dir.p.locator("input[readonly]").inputValue();
assert(managerUrl.includes("/invite/"), "директор пригласил руководителя филиала");

// 3. Руководитель: регистрация, приглашение сотрудника
const mgr = await ctx();
await register(mgr.p, managerUrl, "Мария Руководитель", "manager", "manager-pass-1");
await mgr.p.waitForURL(BASE + "/"); await hydrated(mgr.p);
await mgr.p.getByRole("link", { name: "Настройки системы" }).click();
await mgr.p.getByRole("tab", { name: "Приглашения" }).click();
await mgr.p.getByLabel("Кому (подсказка имени)").fill("Иван Пекарев");
await mgr.p.keyboard.press("Control+Enter");
const employeeUrl = await mgr.p.locator("input[readonly]").inputValue();
assert(employeeUrl.includes("/invite/"), "руководитель пригласил сотрудника");

// 4. Сотрудник на телефоне: до теста открыто только обучение; уроки, тест — рабочее место открывается
const emp = await ctx({ ...devices["iPhone 13"] });
await register(emp.p, employeeUrl, "Иван Пекарев", "ivan", "employee-pass-1");
await emp.p.waitForURL("**/training"); await hydrated(emp.p);
await emp.p.getByText("Откроется после теста").waitFor();
assert((await (await emp.c.request.get(BASE + "/api/crm/leads")).status()) === 403, "до теста рабочее место закрыто на сервере");
await emp.p.getByRole("link", { name: "Открыть уроки" }).click();
for (let i = 0; i < 3; i++) {
  await emp.p.getByRole("button", { name: "Урок пройден" }).first().click();
  await emp.p.getByText(`Уроки: ${i + 1} из 3`).waitFor();
}
await emp.p.goto(BASE + "/training");
await emp.p.getByRole("link", { name: "Пройти тест" }).click();
await emp.p.getByText("Где фиксируется вся работа с клиентом?").waitFor();
const sets = emp.p.locator("fieldset");
const answers = ["В карточке заявки в CRM", "В течение 15 минут", "Назначить следующий контакт", "Причину отказа", "Только согласованные в компании условия"];
for (let i = 0; i < answers.length; i++) await sets.nth(i).getByLabel(answers[i]).check();
await emp.p.getByText("Отвечено: 5 из 5").waitFor();
await emp.p.getByRole("button", { name: "Завершить тест" }).click();
await emp.p.getByText("Обучение пройдено. Рабочее место открыто.").waitFor();
await emp.p.screenshot({ path: SHOTS + "/acc-1-admitted-phone.png" });
log("ok: сотрудник прошёл стартовое обучение и тест — рабочее место открылось само");

// 5. Сотрудник на телефоне: заявка и смена этапа
await emp.p.goto(BASE + "/crm");
await emp.p.getByText("Заявок пока нет").waitFor();
await emp.p.getByRole("button", { name: "Новая заявка" }).first().click();
const create = emp.p.getByRole("dialog");
await create.getByLabel("Клиент", { exact: true }).fill("Кофейня «Утро»");
await create.getByLabel(/Телефон/).fill("+7 701 555 44 33");
await create.getByRole("button", { name: /Создать/ }).click();
await create.waitFor({ state: "detached" });
await emp.p.getByText("Кофейня «Утро»").first().waitFor();
log("ok: сотрудник создал заявку с телефона");
await emp.p.goto(BASE + "/crm?view=kanban");
await emp.p.getByRole("button", { name: /Действия с заявкой/ }).first().click();
await emp.p.getByRole("menuitem", { name: /→ Контакт/ }).click();
const stage = emp.p.getByRole("dialog");
await stage.getByText("Переход в этап «Контакт»").waitFor();
await stage.getByLabel("Дата контакта").fill("2030-01-15");
await stage.getByLabel(/Комментарий/).fill("Позвонил, ждут меню на неделю");
await stage.getByRole("button", { name: /Перенести|Сохранить/ }).click();
await emp.p.getByText(/перенесена в «Контакт»/).waitFor();
assert(await noHorizontalScroll(emp.p), "CRM на телефоне без горизонтальной прокрутки");
await emp.p.screenshot({ path: SHOTS + "/acc-2-kanban-phone.png" });
log("ok: сотрудник перевёл заявку в «Контакт»");

// 6. Руководитель на ПК: изменение видно в отчёте, переход к исходной сделке
await mgr.p.goto(BASE + "/stats");
const ivanRow = mgr.p.locator("tr", { hasText: "Иван Пекарев" });
await ivanRow.waitFor();
const created = ivanRow.locator("td").nth(1);
assert((await created.textContent()).trim() === "1", "в отчёте руководителя у Ивана 1 новая заявка");
const open = ivanRow.locator("td").nth(7);
assert((await open.textContent()).trim() === "1", "и 1 заявка в работе");
await mgr.p.screenshot({ path: SHOTS + "/acc-3-stats.png" });
await created.getByRole("link").click();
await mgr.p.getByText("Кофейня «Утро»").waitFor();
await mgr.p.locator("tbody tr", { hasText: "Кофейня «Утро»" }).click();
await mgr.p.waitForURL("**/crm/*");
await mgr.p.getByText("История").first().waitFor();
await mgr.p.getByText("Позвонил, ждут меню на неделю", { exact: true }).waitFor();
assert(await mgr.p.getByText(/Новый → Контакт|«Новый» → «Контакт»|Этап: Новый → Контакт/).first().isVisible(), "в карточке видны смена этапа и автор");
await mgr.p.screenshot({ path: SHOTS + "/acc-4-lead.png", fullPage: true });
log("ok: руководитель открыл исходную сделку из отчёта");

// 7. Директор на телефоне: та же цифра в статистике компании
const dirPhone = await ctx({ ...devices["iPhone 13"] });
await dirPhone.c.request.post(BASE + "/api/auth/login", { headers: { "x-asc-request": "1" }, data: { login: "director", password: "director-pass-1" } });
await dirPhone.p.goto(BASE + "/stats");
await dirPhone.p.locator("tr", { hasText: "Иван Пекарев" }).waitFor();
assert((await dirPhone.p.locator("tr", { hasText: "Иван Пекарев" }).locator("td").nth(1).textContent()).trim() === "1", "директор на телефоне видит тот же показатель");
assert(await noHorizontalScroll(dirPhone.p), "статистика на телефоне без горизонтальной прокрутки страницы");
await dirPhone.p.screenshot({ path: SHOTS + "/acc-5-stats-phone.png" });

// 8. Изоляция: руководитель другого филиала не видит заявку
await (await dir.c.request.post(BASE + "/api/branches", { headers: { "x-asc-request": "1" }, data: { name: "Пекарня на Сейфуллина" } })).json();
const branches = (await (await dir.c.request.get(BASE + "/api/branches")).json()).branches;
const other = branches.find((b) => b.name === "Пекарня на Сейфуллина");
const inv = await (await dir.c.request.post(BASE + "/api/invitations", { headers: { "x-asc-request": "1" }, data: { role: "manager", branchId: other.id } })).json();
const stranger = await ctx();
await stranger.c.request.post(BASE + `/api/invitations/by-token/${inv.path.split("/").pop()}/accept`, { headers: { "x-asc-request": "1" }, data: { displayName: "Пётр Чужой", login: "petr", password: "manager-pass-2" } });
const leadId = new URL(mgr.p.url()).pathname.split("/").pop();
assert((await (await stranger.c.request.get(BASE + `/api/crm/leads/${leadId}`)).status()) === 404, "заявка чужого филиала не открывается (404)");
const theirs = await (await stranger.c.request.get(BASE + "/api/crm/leads")).json();
assert(theirs.leads.length === 0, "в своём филиале у чужого руководителя заявок нет");
const theirStats = await (await stranger.c.request.get(BASE + "/api/stats")).json();
assert(!theirStats.employees.some((e) => e.name === "Иван Пекарев"), "в чужой статистике сотрудника нет");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
