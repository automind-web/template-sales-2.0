import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапов 3–4 (CRM: список, канбан, карточка, конфликты). Запуск на чистой БД:
//   npm run dev  →  node e2e/stage3.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OWNER_CODE = process.env.OWNER_CODE ?? "local-owner-code";
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };
const H = { "x-asc-request": "1" };
const token = (path) => path.split("/").pop();

const browser = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1440, height: 900 }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();

// Подготовка: директор, филиал, руководитель, два допущенных сотрудника
const dir = await ctx();
const issued = await api(dir.c, "POST", "/api/owner/activation-links", { code: OWNER_CODE, companyName: "Демо: пекарни «Колос»" });
await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Анна Директорова", login: "director", password: "director-pass-1" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Центральная пекарня" })).branch;
const people = {};
for (const [login, name, role] of [["manager", "Мария Руководитель", "manager"], ["ivan", "Иван Пекарев", "employee"], ["olga", "Ольга Кондитерова", "employee"]]) {
  const inv = await api(dir.c, "POST", "/api/invitations", { role, branchId: branch.id });
  const c = await ctx(login === "ivan" ? { ...devices["iPhone 13"] } : login === "manager" ? { viewport: { width: 2300, height: 1000 } } : {});
  await api(c.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: name, login, password: "secret-pass-1" });
  people[login] = c;
}
const users = (await api(dir.c, "GET", "/api/users")).users;
for (const u of users.filter((u) => u.role === "employee")) await api(dir.c, "PUT", `/api/users/${u.id}/admission`, { admitted: true });
log("ok: компания, филиал, руководитель и два допущенных сотрудника");

const mgr = people.manager;
await mgr.p.goto(BASE + "/crm");
await mgr.p.getByText("Заявок пока нет").waitFor();
log("ok: пустое состояние CRM");

// Создание лидов через диалог (Ctrl+Enter)
const leadsToCreate = [
  ["Кафе «Утро»", "+7 701 111 22 33", "Иван Пекарев", "150000"],
  ["Ресторан «Самал»", "+7 702 222 33 44", "Ольга Кондитерова", ""],
  ["Магазин «Ромашка»", "", "Иван Пекарев", ""],
];
for (const [client, phone, owner, amount] of leadsToCreate) {
  await mgr.p.getByRole("button", { name: "Новая заявка" }).first().click();
  const d = mgr.p.getByRole("dialog");
  await d.getByLabel("Клиент", { exact: true }).fill(client);
  if (phone) await d.getByLabel(/Телефон/).fill(phone);
  await d.getByLabel("Ответственный").selectOption({ label: owner });
  if (amount) await d.getByLabel(/Сумма/).fill(amount);
  await mgr.p.keyboard.press("Control+Enter");
  await d.waitFor({ state: "detached" });
}
await mgr.p.getByText("Найдено: 3").waitFor();
await mgr.p.screenshot({ path: SHOTS + "/s3-list.png" });
log("ok: три лида созданы через диалог");

// Поиск «/» и фильтры в адресе
await mgr.p.locator("body").click({ position: { x: 700, y: 800 } });
await mgr.p.keyboard.press("/");
assert(await mgr.p.evaluate(() => document.activeElement?.getAttribute("type") === "search"), "«/» переводит к поиску");
await mgr.p.keyboard.type("самал");
await mgr.p.getByText("Найдено: 1").waitFor();
await mgr.p.waitForURL(/q=/);
await mgr.p.getByRole("searchbox").fill("");
await mgr.p.getByText("Найдено: 3").waitFor();
await mgr.p.getByLabel("Ответственный").selectOption({ label: "Иван Пекарев" });
await mgr.p.getByText("Найдено: 2").waitFor();
const listNames = (await mgr.p.locator("tbody tr").allTextContents()).map((s) => s.includes("Утро") ? "Утро" : s.includes("Ромашка") ? "Ромашка" : s).sort();
// Тот же фильтр на канбане
await mgr.p.getByRole("button", { name: "Доска" }).click();
await mgr.p.waitForURL(/view=kanban/);
assert((await mgr.p.url()).includes("owner="), "фильтр сохранился при переключении вида");
const boardNames = (await mgr.p.locator("li[data-lead] h3").allTextContents()).map((s) => s.includes("Утро") ? "Утро" : "Ромашка").sort();
assert(JSON.stringify(listNames) === JSON.stringify(boardNames), "список и канбан с одинаковыми фильтрами дают одинаковые лиды: " + boardNames);
await mgr.p.getByLabel("Ответственный").selectOption({ label: "Все ответственные" });
await mgr.p.locator("li[data-lead]").nth(2).waitFor();

// Перетаскивание: запрещённая колонка
const card = (name) => mgr.p.locator("li[data-lead]", { hasText: name });
const column = (label) => mgr.p.locator("section", { has: mgr.p.getByRole("heading", { name: new RegExp("^" + label) }) });
await card("Утро").dragTo(column("Сделка"));
await mgr.p.getByText("Из этапа «Новый» в «Сделка» перейти нельзя").waitFor();
assert(await column("Новый").locator("li[data-lead]", { hasText: "Утро" }).isVisible(), "запрещённая колонка: карточка осталась на месте");

// Перетаскивание в «Контакт» требует дату контакта → та же форма, что в меню
await card("Утро").dragTo(column("Контакт"));
const sd = mgr.p.getByRole("dialog");
await sd.getByText("Переход в этап «Контакт»").waitFor();
await sd.getByLabel("Дата контакта").fill("2030-01-15");
await sd.getByLabel(/Комментарий/).fill("Договорились созвониться");
await mgr.p.keyboard.press("Control+Enter");
await sd.waitFor({ state: "detached" });
await column("Контакт").locator("li[data-lead]", { hasText: "Утро" }).waitFor();
log("ok: перенос с обязательным полем через форму этапа");

// Отказ сервера: лид изменили в другом окне (конфликт версий) → карточка возвращается
const leadsNow = (await api(mgr.c, "GET", `/api/crm/leads?branchId=${branch.id}`)).leads;
const romashka = leadsNow.find((l) => l.clientName.includes("Ромашка"));
await api(dir.c, "PUT", "/api/me/branch", { branchId: branch.id });
await api(dir.c, "PATCH", `/api/crm/leads/${romashka.id}`, { opId: "dirop" + Date.now(), version: romashka.version, changes: { amount: 5000 } });
await card("Ромашка").dragTo(column("Отказ"));
const lostDialog = mgr.p.getByRole("dialog");
await lostDialog.getByLabel("Причина отказа").fill("Нет бюджета");
await mgr.p.keyboard.press("Control+Enter");
await mgr.p.getByText("Заявку уже изменил другой пользователь").waitFor();
await column("Новый").locator("li[data-lead]", { hasText: "Ромашка" }).waitFor();
log("ok: отказ сервера (конфликт версий) — карточка на прежнем месте, причина показана");
await card("Ромашка").dragTo(column("Отказ"));
await mgr.p.getByRole("dialog").getByLabel("Причина отказа").fill("Нет бюджета");
await mgr.p.keyboard.press("Control+Enter");
await column("Отказ").locator("li[data-lead]", { hasText: "Ромашка" }).waitFor();
log("ok: повторный перенос после обновления прошёл");
await mgr.p.screenshot({ path: SHOTS + "/s3-kanban.png" });

// Переход в карточку и обратно: вид и фильтры восстанавливаются
await mgr.p.getByRole("button", { name: "Список" }).click();
await mgr.p.getByRole("button", { name: /^Новый \d+$/ }).click(); // пилюля этапа «Новый»
await mgr.p.waitForURL(/stage=new/);

const rows = mgr.p.locator("tbody tr");
await rows.first().focus();
await mgr.p.keyboard.press("Enter");
await mgr.p.waitForURL(/\/crm\/[a-z0-9-]+$/);
await mgr.p.getByText("История").first().waitFor();
await mgr.p.screenshot({ path: SHOTS + "/s3-card.png" });
// Конфликт в карточке: другой пользователь меняет лид, введённый текст сохраняется
const currentId = mgr.p.url().split("/").pop();
const before = (await api(dir.c, "GET", `/api/crm/leads/${currentId}`)).lead;
await api(dir.c, "PATCH", `/api/crm/leads/${currentId}`, { opId: "dirop2" + Date.now(), version: before.version, changes: { clientCompany: "ТОО Директор" } });
await mgr.p.getByLabel("Компания клиента").fill("ТОО Менеджер");
await mgr.p.getByLabel("Компания клиента").press("Control+Enter");
await mgr.p.getByText("Заявку уже изменили").waitFor();
assert((await mgr.p.getByLabel("Компания клиента").inputValue()) === "ТОО Менеджер", "при конфликте введённый текст сохранён");
await mgr.p.getByRole("button", { name: /^Сохранить/ }).click();
await mgr.p.getByText("Сохранено.").waitFor();
log("ok: после конфликта сохранение с актуальной версией");
await mgr.p.getByRole("textbox", { name: "Написать комментарий" }).fill("Клиент просил КП");
await mgr.p.getByRole("button", { name: /Отправить/ }).click();
await mgr.p.locator("li", { hasText: "Клиент просил КП" }).first().waitFor();
assert(await mgr.p.getByText(/Компания клиента: — → ТОО Директор/).isVisible(), "история: автор и прежнее значение");
await mgr.p.getByRole("button", { name: "← К списку заявок" }).click();
await mgr.p.waitForURL(/stage=new/);
assert(mgr.p.url().includes("stage=new"), "после возврата фильтр этапа сохранился");

// Сотрудник на телефоне: свои лиды, перенос через меню «…»
const ivan = people.ivan;
await ivan.p.goto(BASE + "/crm?view=kanban");
await ivan.p.locator("li[data-lead]").first().waitFor();
const mine = await ivan.p.locator("li[data-lead] h3").allTextContents();
assert(mine.length === 2 && !mine.some((n) => n.includes("Самал")), "сотрудник видит только свои лиды: " + mine);
await ivan.p.getByRole("button", { name: /Действия с заявкой/ }).first().click();
await ivan.p.getByRole("menuitem", { name: /→ Встреча/ }).click();
// Дата контакта уже есть — обязательных полей не требуется, перенос сразу
await ivan.p.getByText(/перенесена в «Встреча»/).waitFor();
log("ok: перенос через меню карточки на телефоне");
await ivan.p.screenshot({ path: SHOTS + "/s3-mobile-kanban.png" });
assert(!(await ivan.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки страницы на телефоне (колонки прокручиваются внутри)");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
