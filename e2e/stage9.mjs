import { readFileSync } from "node:fs";
import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Меню: сворачивание бокового меню на ПК (кнопка, Ctrl+B, запоминание, подсказки)
// и нижняя панель на телефоне (вкладки, «Ещё», отметки, без горизонтальной прокрутки).
// Запуск на чистой БД: npm run dev → node e2e/stage9.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
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
  const reload = p.reload.bind(p);
  p.reload = async (...a) => { const r = await reload(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();
const width = (p) => p.locator("aside").evaluate((el) => Math.round(el.getBoundingClientRect().width));

// Подготовка: директор, филиал, сотрудник
const owner = await ctx();
const issued = await api(owner.c, "POST", "/api/owner/activation-links", { code: vars.OWNER_ACTIVATION_CODE, companyName: "Пекарни «Колос»" });
const dir = await ctx();
await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Анна Директорова", login: "director", password: "pass1234" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Центральная пекарня" })).branch;
const inv = await api(dir.c, "POST", "/api/invitations", { role: "employee", branchId: branch.id });
const emp = await ctx({ ...devices["iPhone 13"] });
await api(emp.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: "Иван Пекарев", login: "ivan", password: "secret-pass-1" });
const ivanId = (await api(dir.c, "GET", "/api/users")).users.find((u) => u.login === "ivan").id;
await api(dir.c, "PUT", `/api/users/${ivanId}/admission`, { admitted: true });

// ПК: сворачивание кнопкой
await dir.p.goto(BASE + "/");
assert((await width(dir.p)) > 200, "меню развёрнуто по умолчанию");
await dir.p.getByRole("button", { name: "Свернуть меню" }).click();
await dir.p.waitForTimeout(300);
assert((await width(dir.p)) < 90, "меню свёрнуто до значков");
assert((await dir.p.locator("aside").getByText("Статистика").evaluate((el) => el.getBoundingClientRect().width)) <= 1, "подписи скрыты (остаются для экранного диктора)");
await dir.p.locator('aside a[href="/stats"]').hover();
await dir.p.getByRole("tooltip").filter({ hasText: "Статистика" }).waitFor();
log("ok: подсказка с названием при наведении");
await dir.p.screenshot({ path: SHOTS + "/s9-desktop-collapsed.png" });
await dir.p.locator('aside a[href="/stats"]').click();
await dir.p.waitForURL(BASE + "/stats");
assert((await width(dir.p)) < 90, "при переходе меню остаётся свёрнутым");
await dir.p.reload();
assert((await width(dir.p)) < 90, "после перезагрузки меню свёрнуто (запомнено)");
assert(await dir.p.locator('html[data-nav="collapsed"]').count() === 1, "состояние восстановлено до отрисовки");

// Горячая клавиша
await dir.p.locator("main").click({ position: { x: 5, y: 5 } });
await dir.p.keyboard.press("Control+b");
await dir.p.waitForTimeout(300);
assert((await width(dir.p)) > 200, "Ctrl+B разворачивает меню");
await dir.p.keyboard.press("Control+b");
await dir.p.waitForTimeout(300);
assert((await width(dir.p)) < 90, "Ctrl+B сворачивает меню");
await dir.p.getByRole("button", { name: "Развернуть меню" }).click();
await dir.p.waitForTimeout(300);
assert((await width(dir.p)) > 200, "кнопка разворачивает меню");
await dir.p.screenshot({ path: SHOTS + "/s9-desktop-expanded.png" });
assert(!(await dir.p.locator("#tab-bar").isVisible()), "нижней панели на ПК нет");

// Телефон директора: 4 вкладки и «Ещё»
const dirPhone = await ctx({ ...devices["iPhone 13"] });
await api(dirPhone.c, "POST", "/api/auth/login", { login: "director", password: "pass1234" });
await dirPhone.p.goto(BASE + "/");
const tabs = (await dirPhone.p.locator("#tab-bar > div > *").allTextContents()).map((s) => s.trim());
assert(JSON.stringify(tabs) === JSON.stringify(["Главная", "CRM", "KPI", "Статистика", "Ещё"]), "вкладки директора: " + tabs.join(", "));
assert(!(await dirPhone.p.locator("aside").isVisible()), "бокового меню на телефоне нет");
assert(await dirPhone.p.locator('#tab-bar a[aria-current="page"]', { hasText: "Главная" }).count() === 1, "активная вкладка отмечена");
const noScroll = await dirPhone.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
assert(noScroll, "без горизонтальной прокрутки");
await dirPhone.p.screenshot({ path: SHOTS + "/s9-phone-tabbar.png" });
await dirPhone.p.getByRole("button", { name: "Ещё" }).click();
const sheet = dirPhone.p.getByRole("dialog", { name: "Все разделы" });
await sheet.waitFor();
for (const name of ["Обучение", "WhatsApp Studio", "Настройки системы", "Анна Директорова"]) assert(await sheet.getByText(name).first().isVisible(), "в «Ещё»: " + name);
await dirPhone.p.waitForTimeout(350);
await dirPhone.p.screenshot({ path: SHOTS + "/s9-phone-more.png" });
await sheet.getByRole("link", { name: /WhatsApp Studio/ }).click();
await dirPhone.p.waitForURL(BASE + "/whatsapp");
await sheet.waitFor({ state: "detached" });
log("ok: переход из «Ещё» закрывает лист");
assert(await dirPhone.p.locator("#tab-bar button[aria-expanded]", { hasText: "Ещё" }).locator(".text-primary").count() > 0, "«Ещё» подсвечено, когда открыт раздел из него");
await dirPhone.p.getByRole("link", { name: "CRM" }).click();
await dirPhone.p.waitForURL("**/crm**");
log("ok: переход по вкладке");
// Последний элемент страницы не прячется под панелью
const covered = await dirPhone.p.evaluate(() => {
  const bar = document.getElementById("tab-bar").getBoundingClientRect();
  window.scrollTo(0, document.body.scrollHeight);
  const content = document.getElementById("content");
  const pad = parseFloat(getComputedStyle(content).paddingBottom);
  return pad >= bar.height - 1;
});
assert(covered, "под нижней панелью оставлен отступ");

// Телефон сотрудника: все разделы помещаются, «Ещё» не нужно
await emp.p.goto(BASE + "/");
const empTabs = (await emp.p.locator("#tab-bar > div > *").allTextContents()).map((s) => s.trim());
assert(JSON.stringify(empTabs) === JSON.stringify(["Главная", "CRM", "KPI", "Обучение", "Профиль"]), "вкладки сотрудника: " + empTabs.join(", "));
await emp.p.getByRole("link", { name: "Профиль" }).click();
await emp.p.waitForURL(BASE + "/profile");
assert(await emp.p.locator('#tab-bar a[aria-current="page"]', { hasText: "Профиль" }).count() === 1, "профиль открыт с вкладки");
await emp.p.screenshot({ path: SHOTS + "/s9-phone-employee.png" });

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
