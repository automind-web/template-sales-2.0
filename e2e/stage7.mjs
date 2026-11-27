import { readFileSync } from "node:fs";
import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// WhatsApp Studio в системе. Запуск на чистой БД:
//   npm run dev  →  node e2e/stage7.mjs [папка-для-снимков]
// Реальные Whapi и ChatGPT здесь не вызываются: проверяются доступ, агент, ключи, база знаний.
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
  const c = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1440, height: 950 }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/eval\(\)|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const goto = p.goto.bind(p);
  p.goto = async (...a) => { const r = await goto(...a); await p.waitForSelector("html[data-hydrated]"); return r; };
  return { c, p };
}
const api = async (c, method, path, data) => (await c.request.fetch(BASE + path, { method, headers: H, data })).json();

const dir = await ctx();
const issued = await api(dir.c, "POST", "/api/owner/activation-links", { code: vars.OWNER_ACTIVATION_CODE, companyName: "Пекарни «Колос»" });
await api(dir.c, "POST", `/api/invitations/by-token/${token(issued.path)}/accept`, { displayName: "Анна Директорова", login: "director", password: "director-pass-1" });
const branch = (await api(dir.c, "POST", "/api/branches", { name: "Центральная пекарня" })).branch;
const inv = await api(dir.c, "POST", "/api/invitations", { role: "manager", branchId: branch.id });
const mgr = await ctx();
await api(mgr.c, "POST", `/api/invitations/by-token/${token(inv.path)}/accept`, { displayName: "Мария Руководитель", login: "manager", password: "secret-pass-1" });

// Руководителю студия закрыта (ключи — только у директора)
await mgr.p.goto(BASE + "/");
assert((await mgr.p.locator("aside").getByText("WhatsApp Studio").count()) === 0, "руководитель не видит WhatsApp Studio в меню");
assert((await mgr.c.request.get(BASE + "/api/wa/bootstrap")).status() === 403, "на сервере студия закрыта для руководителя");

// Директор: агент из стартовой инструкции, филиал для заявок
await dir.p.goto(BASE + "/whatsapp");
await dir.p.getByText("Отвечает клиентам").waitFor();
await dir.p.screenshot({ path: SHOTS + "/s7-welcome.png" });
await dir.p.getByRole("button", { name: "Создать агента" }).first().click();
const dialog = dir.p.locator("dialog[open]");
await dialog.locator("input").first().fill("Консультант");
assert((await dialog.locator("select").inputValue()) === branch.id, "единственный филиал выбран для заявок по умолчанию");
await dialog.getByRole("button", { name: /Создать агента/ }).click();
const prompt = dir.p.locator('textarea[aria-label="Инструкция агента"]').first();
await prompt.waitFor();
const text = await prompt.inputValue();
assert(text.includes("компании «Пекарни «Колос»»") && text.includes("только из базы знаний"), "стартовая инструкция с названием компании");
assert(await dir.p.getByLabel("Филиал для заявок").isVisible(), "в настройках видно, в какой филиал идут заявки");

// Ключи: сохраняются и не возвращаются в браузер
await dir.p.getByLabel("Ключ WhatsApp").fill("whapi-test-key-1234567890");
await dir.p.getByPlaceholder("Сохранён •••••••••••••").first().waitFor({ timeout: 15000 });
const boot = await (await dir.c.request.get(BASE + "/api/wa/bootstrap")).text();
assert(!boot.includes("whapi-test-key-1234567890"), "ключ WhatsApp сохранён и не возвращается в браузер");

// База знаний: файл .txt
const file = { name: "Доставка.txt", mimeType: "text/plain", buffer: Buffer.from("Доставка по городу занимает 1 день, бесплатно от 10 000 тенге.") };
// Пока ключ сохраняется, рабочая область недоступна для нажатий — ждём окончания
for (let i = 0; i < 20 && !(await dir.p.locator("dialog[open]").count()); i++) {
  await dir.p.getByRole("button", { name: "Добавить файлы" }).first().click();
  await dir.p.waitForTimeout(300);
}
await dir.p.locator("dialog[open] input[type=file]").setInputFiles(file);
await dir.p.getByText("Добавлен в базу").waitFor();
await dir.p.locator("dialog[open]").getByRole("button", { name: "Готово" }).click();
await dir.p.getByText("Доставка.txt").waitFor();
log("ok: файл добавлен в базу знаний");
await dir.p.waitForTimeout(800);
await dir.p.screenshot({ path: SHOTS + "/s7-studio.png" });

// Телефон: студия без горизонтальной прокрутки
const phone = await ctx({ ...devices["iPhone 13"] });
await api(phone.c, "POST", "/api/auth/login", { login: "director", password: "director-pass-1" });
await phone.p.goto(BASE + "/whatsapp");
await phone.p.locator('textarea[aria-label="Инструкция агента"]').first().waitFor();
assert(!(await phone.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "нет горизонтальной прокрутки на телефоне");
await phone.p.screenshot({ path: SHOTS + "/s7-phone.png", fullPage: true });

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
