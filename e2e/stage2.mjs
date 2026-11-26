import { createRequire } from "node:module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
// Сквозной сценарий этапа 2 (обучение) в браузере. Запуск на чистой БД:
//   npm run dev  →  node e2e/stage2.mjs [папка-для-снимков]
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OWNER_CODE = process.env.OWNER_CODE ?? "local-owner-code";
const TOKEN = process.env.INTEGRATION_TOKEN ?? "local-integration-token";
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

function edition(v) {
  const right = v === 1 ? "a" : "b";
  return {
    approved: true, title: `Основы продаж`, externalRef: `rev-${v}`, description: "Обязательный курс для работы в CRM.",
    lessons: [
      { key: "intro", title: "Наш клиент", body: "# Кто покупает\n\nКлиенты — малый и средний бизнес.\n\n- звонок в течение часа\n- запись в CRM", fileIds: [] },
      { key: "calls", title: "Первый звонок", body: "Скрипт первого звонка.", durationMinutes: 10 },
    ],
    test: { passPercent: 80, questions: [1, 2, 3, 4, 5].map((n) => ({
      key: `q${n}`, text: `Вопрос ${n}: выберите вариант ${right.toUpperCase()} (редакция ${v})`, kind: n === 5 ? "multiple" : "single",
      options: [{ key: "a", text: "Вариант A" }, { key: "b", text: "Вариант B" }, { key: "c", text: "Вариант C" }],
      correct: n === 5 ? [right, "c"] : [right],
    })) },
  };
}
async function integration(path, body, isForm = false) {
  const r = await fetch(BASE + path, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, ...(isForm ? {} : { "content-type": "application/json" }) }, body: isForm ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// Подготовка через API: компания, директор, филиал, сотрудник
const dir = await ctx();
const issued = await (await dir.c.request.post(BASE + "/api/owner/activation-links", { headers: H, data: { code: OWNER_CODE, companyName: "Демо" } })).json();
await dir.c.request.post(BASE + `/api/invitations/by-token/${token(issued.path)}/accept`, { headers: H, data: { displayName: "Айгерим Директорова", login: "aigerim", password: "director-pass-1" } });
const branch = await (await dir.c.request.post(BASE + "/api/branches", { headers: H, data: { name: "Север" } })).json();
const inv = await (await dir.c.request.post(BASE + "/api/invitations", { headers: H, data: { role: "employee", branchId: branch.branch.id } })).json();
const emp = await ctx({ ...devices["iPhone 13"] });
await emp.c.request.post(BASE + `/api/invitations/by-token/${token(inv.path)}/accept`, { headers: H, data: { displayName: "Константин Длиннофамильный-Сотрудниковский", login: "kostya", password: "employee-pass-1" } });
log("ok: подготовлены директор, филиал, сотрудник");

// Пустое состояние до загрузки курса
await emp.p.goto(BASE + "/training");
await emp.p.getByText("Назначенных курсов пока нет.").waitFor();
await emp.p.getByText("требуется для допуска, но ещё не загружен").waitFor();
log("ok: пустое состояние и подсказка о незагруженном курсе");

// Интеграция: файл + редакция 1
const form = new FormData();
form.set("courseKey", "sales-basics");
form.set("file", new File([new TextEncoder().encode("%PDF-1.4 памятка")], "Памятка менеджера.pdf", { type: "application/pdf" }));
const file = await integration("/api/integration/training/files", form, true);
assert(file.status === 200, "файл загружен в R2 через интеграцию");
const e1 = edition(1); e1.lessons[0].fileIds = [file.body.fileId];
const v1 = await integration("/api/integration/training/courses/sales-basics/versions", e1);
assert(v1.status === 200 && v1.body.version === 1, "редакция 1 опубликована");

// Сотрудник на телефоне: курс, урок, файл
await emp.p.reload();
await emp.p.getByText("Нужен для допуска к CRM").waitFor();
await emp.p.screenshot({ path: SHOTS + "/s2-employee-courses-mobile.png" });
await emp.p.getByRole("link", { name: "Открыть курс" }).click();
await emp.p.getByRole("heading", { name: "Основы продаж" }).waitFor();
await emp.p.getByText("звонок в течение часа").waitFor();
const fileLink = emp.p.getByRole("link", { name: "Памятка менеджера.pdf" });
const href = await fileLink.getAttribute("href");
const fileResp = await emp.c.request.get(BASE + href);
assert(fileResp.status() === 200 && fileResp.headers()["content-type"] === "application/pdf", "файл урока скачивается с проверкой прав");
await emp.p.getByRole("button", { name: "Урок пройден" }).first().click();
await emp.p.getByText("Уроки: 1 из 2").waitFor();
log("ok: урок отмечен, прогресс 1 из 2");

// Тест: начать, ответить частично, перезагрузить
await emp.p.getByRole("link", { name: "Начать тест" }).click();
await emp.p.waitForURL(/attempt=/);
await emp.p.getByText("Вопрос 1: выберите вариант A").waitFor();
await emp.p.getByLabel("Вариант A").first().check();
await emp.p.getByText("Отвечено: 1 из 5").waitFor();
await emp.p.waitForTimeout(1200);
// Выходит редакция 2
const v2 = await integration("/api/integration/training/courses/sales-basics/versions", edition(2));
assert(v2.body.version === 2, "во время теста вышла редакция 2");
await emp.p.reload();
await emp.p.getByText("Этот тест начат по редакции 1").waitFor();
assert(await emp.p.getByText("Вопрос 1: выберите вариант A").isVisible(), "вопросы остались по редакции 1");
assert(await emp.p.getByLabel("Вариант A").first().isChecked(), "ответ сохранился после перезагрузки");
await emp.p.screenshot({ path: SHOTS + "/s2-test-mobile.png", fullPage: true });

// Ответить на всё по редакции 1 и завершить
const sets = emp.p.locator("fieldset");
for (let i = 1; i < 4; i++) await sets.nth(i).getByLabel("Вариант A").check();
await sets.nth(4).getByLabel("Вариант A").check();
await sets.nth(4).getByLabel("Вариант C").check();
await emp.p.getByRole("button", { name: "Завершить тест" }).click();
await emp.p.getByText("Правильных ответов: 5 из 5 — 100%").waitFor();
await emp.p.getByText("Допуск к CRM получен").waitFor();
await emp.p.screenshot({ path: SHOTS + "/s2-result-mobile.png" });
log("ok: тест сдан по редакции 1, допуск выдан");
await emp.p.getByRole("link", { name: "CRM" }).first().click();
await emp.p.waitForURL("**/crm");
await emp.p.getByText("Раздел появится на следующем этапе").waitFor();
log("ok: CRM открыт после допуска");
const overflow = await emp.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert(!overflow, "нет горизонтальной прокрутки на телефоне");

// Следующая попытка — по редакции 2
await emp.p.goto(BASE + "/training");
await emp.p.getByRole("link", { name: "Пройти тест ещё раз" }).click();
await emp.p.getByText("выберите вариант B (редакция 2)").first().waitFor();
log("ok: новая попытка — по редакции 2");

// Неполный ответ: подтверждение в диалоге, Esc закрывает
await emp.p.getByRole("button", { name: "Завершить тест" }).click();
await emp.p.getByRole("dialog").getByText("Без ответа: 5").waitFor();
await emp.p.keyboard.press("Escape");
await emp.p.getByRole("dialog").waitFor({ state: "detached" });
log("ok: подтверждение при неотвеченных вопросах, Esc закрывает");

// Директор: прогресс, каталог, правила
await dir.p.goto(BASE + "/training");
await dir.p.getByText("Константин Длиннофамильный-Сотрудниковский").waitFor();
await dir.p.locator("tr", { hasText: "Константин" }).getByText("Допущен").waitFor();
await dir.p.locator("tr", { hasText: "Константин" }).getByText("Тест начат").waitFor();
await dir.p.locator("tr", { hasText: "Константин" }).getByText("100% · ред. 1").waitFor();
await dir.p.screenshot({ path: SHOTS + "/s2-director-team.png" });
log("ok: директор видит прогресс, результат и версию");
await dir.p.getByRole("tab", { name: "Курсы и версии" }).click();
await dir.p.getByRole("cell", { name: "Редакция 2" }).waitFor();
await dir.p.getByRole("cell", { name: "Редакция 1" }).waitFor();
await dir.p.screenshot({ path: SHOTS + "/s2-director-catalog.png" });
log("ok: история редакций");
await dir.p.getByRole("tab", { name: "Правила допуска" }).click();
await dir.p.getByText("Сейчас действуют правила по умолчанию").waitFor();
await dir.p.getByLabel("Минимум, %").fill("90");
await dir.p.keyboard.press("Control+Enter");
await dir.p.getByText("Правила сохранены.").waitFor();
await dir.p.reload();
assert((await dir.p.getByLabel("Минимум, %").inputValue()) === "90", "правило сохранено (Ctrl+Enter), после перезагрузки 90%");
await dir.p.screenshot({ path: SHOTS + "/s2-director-rules.png" });

console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
