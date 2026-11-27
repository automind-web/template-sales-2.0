import { readFileSync } from "node:fs";
import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Доступы и KPI: разовая активация, перевыпуск приглашения, рабочие роли, журнал прав,
// формула сотрудника, дата начала, предпросмотр, копирование, перетаскивание блоков, прогноз.
// Запуск на чистой БД: npm run dev → node e2e/stage8.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };
const H = { "x-asc-request": "1" };
const token = (path) => path.split("/").pop();
let n = 0;
const op = () => `s8-${Date.now()}-${n++}-xxxx`;

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1440, height: 950 }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();

// Активация (пароль из 8 символов) и подготовка
const owner = await ctx();
const issued = await api(owner.c, "POST", "/api/owner/activation-links", { code: vars.OWNER_ACTIVATION_CODE, companyName: "Пекарни «Колос»" });
const dir = await ctx();
const accepted = await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Анна Директорова", login: "director", password: "pass1234" });
assert(accepted.ok, "пароль из 8 символов принят");
await owner.p.goto(BASE + "/owner");
await owner.p.getByText("Компания уже активирована").waitFor();
assert(await owner.p.getByLabel("Логин директора").isVisible(), "после активации владельцу доступно только восстановление директора");
await owner.p.screenshot({ path: SHOTS + "/s8-owner-activated.png" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Центральная пекарня" })).branch;
const people = {};
for (const [login, name] of [["ivan", "Иван Пекарев"], ["olga", "Ольга Кондитерова"]]) {
  const inv = await api(dir.c, "POST", "/api/invitations", { role: "employee", branchId: branch.id });
  const c = await ctx();
  await api(c.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: name, login, password: "secret-pass-1" });
  people[login] = c;
}
for (const u of (await api(dir.c, "GET", "/api/users")).users.filter((u) => u.role === "employee")) await api(dir.c, "PUT", `/api/users/${u.id}/admission`, { admitted: true });
for (let k = 0; k < 4; k++) await api(people.ivan.c, "POST", "/api/crm/leads", { opId: op(), clientName: "Клиент " + k });

// Перевыпуск приглашения
await dir.p.goto(BASE + "/settings?tab=invitations");
await dir.p.getByLabel("Кому (подсказка имени)").fill("Пётр Новый");
await dir.p.keyboard.press("Control+Enter");
const firstUrl = await dir.p.locator("input[readonly]").first().inputValue();
await dir.p.getByRole("button", { name: "Перевыпустить" }).first().click();
await dir.p.getByText("Старая ссылка отключена").waitFor();
const urls = await dir.p.locator("input[readonly]").evaluateAll((els) => els.map((el) => el.value));
const fresh = urls.find((url) => url !== firstUrl);
assert(fresh && fresh.includes("/invite/"), "выдана новая ссылка");
assert((await dir.c.request.get(BASE + `/api/invitations/by-token/${token(firstUrl)}`)).status() === 410, "старая ссылка отключена");

// Рабочие роли
await dir.p.getByRole("tab", { name: "Рабочие роли" }).click();
await dir.p.getByRole("button", { name: /Новая рабочая роль/ }).click();
const roleDialog = dir.p.getByRole("dialog");
await roleDialog.getByLabel("Название").fill("Оператор");
await roleDialog.getByLabel("KPI").uncheck();
await roleDialog.getByLabel("Статистика").uncheck();
await roleDialog.getByRole("button", { name: /Создать/ }).click();
await dir.p.locator("main").getByText("Оператор", { exact: true }).waitFor();
await dir.p.screenshot({ path: SHOTS + "/s8-work-roles.png" });
await dir.p.getByRole("tab", { name: "Сотрудники" }).click();
await dir.p.getByLabel("Рабочая роль: Иван Пекарев").selectOption({ label: "Оператор" });
await dir.p.waitForTimeout(600);
assert((await people.ivan.c.request.get(BASE + "/api/kpi/report")).status() === 403, "рабочая роль закрыла KPI на сервере");
await people.ivan.p.goto(BASE + "/");
await people.ivan.p.locator("aside").getByText("Оператор · Центральная пекарня").waitFor();
log("ok: в карточке пользователя — рабочая роль");
assert((await people.ivan.p.locator("aside").getByText("KPI").count()) === 0, "KPI нет в меню сотрудника с ролью «Оператор»");
await dir.p.getByLabel("Рабочая роль: Иван Пекарев").selectOption({ label: "Без роли" });
await dir.p.waitForTimeout(600);

// Журнал прав
await dir.p.getByRole("tab", { name: "Журнал прав" }).click();
await dir.p.getByText("Создана рабочая роль «Оператор»: CRM").waitFor();
await dir.p.getByText(/Приглашение перевыпущено/).first().waitFor();
await dir.p.screenshot({ path: SHOTS + "/s8-access-log.png", fullPage: true });
log("ok: журнал прав показывает изменения доступов");

// KPI: формула Ивана, дата начала, перетаскивание, предпросмотр
await dir.p.goto(BASE + "/kpi?tab=builder");
await dir.p.getByLabel("Методика для").selectOption({ label: "Иван Пекарев · Центральная пекарня" });
await dir.p.getByText(/Отдельная формула для «Иван Пекарев»/).waitFor();
await dir.p.getByLabel("Название").first().fill("Новые заявки");
await dir.p.getByLabel(/План/).first().fill("8");
await dir.p.getByLabel("Поле CRM").selectOption({ label: "Новые заявки" });
await dir.p.getByRole("button", { name: "Поле CRM" }).click();
await dir.p.getByRole("button", { name: "умножить" }).click();
await dir.p.getByLabel("Значение числа").fill("2");
await dir.p.getByRole("button", { name: "Число", exact: true }).click();
// Перетаскивание: «2» на место первого блока → «2 × Новые заявки»
const blocks = dir.p.locator('[aria-label="Формула"] > span[draggable]');
await blocks.nth(2).dragTo(blocks.nth(0));
const order = (await dir.p.locator('[aria-label="Формула"] > span').allTextContents()).map((s) => s.trim());
assert(order.join(" | ") === "2 | Новые заявки | ×", "блок перетащен мышью: " + order.join(" | "));
await blocks.nth(1).dragTo(blocks.nth(0));
await blocks.nth(2).dragTo(blocks.nth(1));
const order2 = (await dir.p.locator('[aria-label="Формула"] > span').allTextContents()).map((s) => s.trim());
assert(order2.join(" | ") === "Новые заявки | × | 2", "порядок восстановлен перетаскиванием: " + order2.join(" | "));
await dir.p.getByRole("button", { name: "Предпросмотр расчёта" }).click();
const preview = dir.p.getByRole("region", { name: "Предпросмотр расчёта" });
await preview.locator("tr", { hasText: "Иван Пекарев" }).waitFor();
assert((await preview.locator("tr", { hasText: "Иван Пекарев" }).textContent()).includes("8 / 8"), "предпросмотр: 4 заявки × 2 = 8 из плана 8");
await dir.p.screenshot({ path: SHOTS + "/s8-kpi-builder.png", fullPage: true });
await dir.p.getByRole("button", { name: /Сохранить как новую версию/ }).click();
await dir.p.getByText("Сохранена версия-черновик").waitFor();
await dir.p.getByRole("button", { name: "Утвердить" }).click();
await dir.p.getByText("Версия утверждена").waitFor();
log("ok: формула сотрудника сохранена и утверждена");

// Копирование на нескольких сотрудников с датой начала
await dir.p.getByRole("button", { name: "Скопировать сотрудникам" }).click();
const copy = dir.p.getByRole("dialog");
await copy.getByLabel("Выбрать всех").check();
await copy.getByRole("button", { name: /Скопировать/ }).click();
await dir.p.getByText(/Формула скопирована: 2 сотр\./).waitFor();
log("ok: формула скопирована на двух сотрудников");

// Прогноз
await dir.p.getByRole("tab", { name: "Прогноз" }).click();
await dir.p.getByText(/Прошло \d+ из \d+ дн\./).waitFor();
await dir.p.locator("main h3", { hasText: "Иван Пекарев" }).waitFor();
await dir.p.screenshot({ path: SHOTS + "/s8-forecast.png", fullPage: true });
log("ok: вкладка прогноза");

// Сотрудник на телефоне: свой прогноз
const phone = await ctx({ ...devices["iPhone 13"] });
await api(phone.c, "POST", "/api/auth/login", { login: "olga", password: "secret-pass-1" });
await phone.p.goto(BASE + "/kpi?tab=forecast");
await phone.p.getByText(/Прошло \d+ из \d+ дн\./).waitFor();
assert(!(await phone.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "прогноз на телефоне без горизонтальной прокрутки");
await phone.p.screenshot({ path: SHOTS + "/s8-forecast-phone.png", fullPage: true });

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
