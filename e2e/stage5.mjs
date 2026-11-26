import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапов 5–6 (KPI и статистика). Запуск на чистой БД:
//   npm run dev  →  node e2e/stage5.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OWNER_CODE = process.env.OWNER_CODE ?? "local-owner-code";
const SHOTS = process.argv[2] ?? "e2e/screenshots";
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); log("ok:", m); };
const H = { "x-asc-request": "1" };
const token = (path) => path.split("/").pop();
let n = 0;
const op = () => `e2e${Date.now()}${n++}xxxx`;

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
const people = {};
for (const [login, name, role, opts] of [["manager", "Мария Руководитель", "manager", {}], ["ivan", "Иван Пекарев", "employee", { ...devices["iPhone 13"] }], ["olga", "Ольга Кондитерова", "employee", {}]]) {
  const inv = await api(dir.c, "POST", "/api/invitations", { role, branchId: branch.id });
  const c = await ctx(opts);
  await api(c.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: name, login, password: "secret-pass-1" });
  people[login] = c;
}
for (const u of (await api(dir.c, "GET", "/api/users")).users.filter((u) => u.role === "employee")) await api(dir.c, "PUT", `/api/users/${u.id}/admission`, { admitted: true });
async function win(c, client, amount) {
  let lead = (await api(c.c, "POST", "/api/crm/leads", { opId: op(), clientName: client })).lead;
  for (const changes of [{ stage: "contact", nextContactAt: Date.now() + 86400000 }, { stage: "proposal", amount }, { stage: "won" }]) lead = (await api(c.c, "PATCH", `/api/crm/leads/${lead.id}`, { opId: op(), version: lead.version, changes })).lead;
}
await win(people.ivan, "Кафе «Утро»", 150000);
await win(people.ivan, "Ресторан «Самал»", 90000);
await win(people.olga, "Магазин «Ромашка»", 40000);
await api(people.olga.c, "POST", "/api/crm/leads", { opId: op(), clientName: "Пекарня «Хлеб»", nextContactAt: Date.now() - 7200000 });
log("ok: данные CRM подготовлены (3 сделки, 1 просрочка)");

const mgr = people.manager;
await mgr.p.goto(BASE + "/kpi");
await mgr.p.getByText("Методика KPI ещё не настроена").waitFor();
await mgr.p.screenshot({ path: SHOTS + "/s5-kpi-setup.png" });
log("ok: без методики показано, что нужно для первого расчёта");

// Конструктор: «Сделки» = Сделки (план 3), «Средний чек» = Выручка ÷ Сделки
await mgr.p.getByRole("button", { name: "Методика" }).click();
await mgr.p.getByLabel("Название").first().fill("Сделки");
await mgr.p.getByLabel(/План/).first().fill("3");
await mgr.p.getByLabel("Поле CRM").first().selectOption({ label: "Сделки" });
await mgr.p.getByRole("button", { name: "Поле CRM" }).first().click();
await mgr.p.getByRole("button", { name: "Добавить показатель" }).click();
const second = mgr.p.locator("fieldset").nth(1);
await second.getByLabel("Название").fill("Средний чек");
await second.getByLabel("Единица").selectOption({ label: "сумма" });
await second.getByLabel(/План/).fill("100000");
await second.getByLabel("Поле CRM").selectOption({ label: "Сделки" });
await second.getByRole("button", { name: "Поле CRM" }).click();
await second.getByRole("button", { name: "разделить" }).click();
await second.getByLabel("Поле CRM").selectOption({ label: "Выручка" });
await second.getByRole("button", { name: "Поле CRM" }).click();
// Порядок неверный (Сделки ÷ Выручка) — меняем через меню блока: «Выручка» влево дважды
await second.getByRole("button", { name: "Блок «Выручка»" }).click();
await mgr.p.getByRole("menuitem", { name: "Сдвинуть влево" }).click();
await second.getByRole("button", { name: "Блок «Выручка»" }).click();
await mgr.p.getByRole("menuitem", { name: "Сдвинуть влево" }).click();
await second.getByRole("button", { name: "Блок «разделить»" }).click();
await mgr.p.getByRole("menuitem", { name: "Сдвинуть влево" }).click();
const blocks = await second.locator('[aria-label="Формула"] > span').allTextContents();
assert(blocks.join(" | ") === "Выручка | ÷ | Сделки", "блоки переставлены через меню: " + blocks.join(" | "));
await mgr.p.screenshot({ path: SHOTS + "/s5-kpi-builder.png", fullPage: true });
await mgr.p.keyboard.press("Control+Enter");
await mgr.p.getByText("Сохранена версия-черновик").waitFor();
await mgr.p.getByRole("button", { name: "Утвердить" }).click();
await mgr.p.getByText("Версия утверждена").waitFor();
log("ok: версия методики сохранена и утверждена");

await mgr.p.getByRole("tab", { name: "Отчёт" }).click();
const ivanRow = mgr.p.locator("tr", { hasText: "Иван Пекарев" });
await ivanRow.waitFor();
const ivanCells = await ivanRow.locator("td").allTextContents();
assert(ivanCells[1].includes("Факт: 2") && ivanCells[1].includes("План: 3") && ivanCells[1].includes("67%"), "KPI «Сделки» у Ивана: факт 2, план 3, 67%: " + ivanCells[1]);
assert(ivanCells[2].replace(/\s/g, " ").includes("120 000"), "средний чек Ивана 120 000: " + ivanCells[2]);
await mgr.p.screenshot({ path: SHOTS + "/s5-kpi-report.png" });

// Статистика: то же число; клик → исходные сделки; возврат — тот же срез
await mgr.p.getByRole("link", { name: "Статистика" }).click();
await mgr.p.getByText("По сотрудникам").waitFor();
await mgr.p.getByRole("button", { name: /^Сделки/ }).click();
await mgr.p.waitForURL(/sort=leads_won/);
const statsIvan = mgr.p.locator("tr", { hasText: "Иван Пекарев" });
const won = statsIvan.locator("td").nth(2);
assert((await won.textContent()).trim() === "2", "статистика «Сделки» у Ивана = 2 (как в KPI)");
await mgr.p.screenshot({ path: SHOTS + "/s5-stats.png" });
const statsUrl = mgr.p.url();
await won.getByRole("link").click();
await mgr.p.getByText("Сделки: исходные сделки").waitFor();
const deals = await mgr.p.locator("tbody tr").allTextContents();
assert(deals.length === 2 && deals.some((d) => d.includes("Утро")) && deals.some((d) => d.includes("Самал")), "открылись исходные сделки показателя");
await mgr.p.screenshot({ path: SHOTS + "/s5-drill.png" });
await mgr.p.getByRole("link", { name: "← К статистике" }).click();
await mgr.p.getByText("По сотрудникам").waitFor();
const back = new URL(mgr.p.url());
const before = new URL(statsUrl);
assert(back.searchParams.get("sort") === "leads_won" && back.searchParams.get("dir") === before.searchParams.get("dir") && back.searchParams.get("from"), "возврат восстановил срез (период) и сортировку");
assert((await mgr.p.getByRole("columnheader", { name: /Сделки ↓/ }).count()) === 1, "сортировка по «Сделкам» снова активна");
await mgr.p.locator("tr", { hasText: "Ольга" }).locator("td").nth(8).getByRole("link").click();
await mgr.p.getByText("Пекарня «Хлеб»").waitFor();
log("ok: «Просроченные контакты» ведут к исходному лиду");

// Сотрудник на телефоне: личный KPI
const ivan = people.ivan;
await ivan.p.goto(BASE + "/kpi");
await ivan.p.getByText("Мой отчёт KPI").waitFor();
await ivan.p.getByText("Выполнение: 67%").waitFor();
assert(!(await ivan.p.getByText("Ольга").count()), "сотрудник видит только свой отчёт");
await ivan.p.screenshot({ path: SHOTS + "/s5-kpi-mobile.png", fullPage: true });
assert(!(await ivan.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки на телефоне");
assert((await (await ivan.c.request.get(BASE + "/api/stats")).status()) === 403, "статистика сотруднику недоступна");

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
