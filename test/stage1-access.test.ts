import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDirector, createTestEnv, invite, OWNER_CODE, TestClient, tokenFromPath } from "./support/client.ts";

type Me = { user: { role: string; admitted: boolean; branchId: string | null }; sections: Record<string, boolean>; selectedBranchId: string | null; branches: Array<{ id: string }> };

test("чистая БД: нет компаний, пользователей и данных", async () => {
    const env = createTestEnv();
    for (const table of ["companies", "branches", "users", "invitations", "sessions", "admissions"]) {
        const row = env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        assert.equal(row.n, 0, `${table} должна быть пустой`);
    }
    const anonymous = new TestClient(env);
    assert.equal((await anonymous.get("/api/me")).status, 401);
});

test("владелец: неверный код, нет секрета, ограничение попыток", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.5.5.5");
    const wrong = await owner.post("/api/owner/activation-links", { code: "wrong" });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error?.code, "owner.invalidCode");

    const noSecretEnv = createTestEnv({ OWNER_ACTIVATION_CODE: "" });
    const noSecret = await new TestClient(noSecretEnv).post("/api/owner/activation-links", { code: "x" });
    assert.equal(noSecret.status, 503);

    for (let i = 0; i < 4; i += 1) await owner.post("/api/owner/activation-links", { code: "wrong" });
    const limited = await owner.post("/api/owner/activation-links", { code: OWNER_CODE });
    assert.equal(limited.status, 429, "после 5 попыток за 15 минут — 429 даже с верным кодом");
});

test("активация директора: ссылка одноразовая, открытие и ошибки формы её не гасят", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.9.9.9");
    const issued = await owner.post<{ path: string; expiresAt: number }>("/api/owner/activation-links", { code: OWNER_CODE, companyName: "Альфа" });
    assert.equal(issued.status, 200);
    assert.match(issued.body.path, /^\/activate\//);
    const hours = (issued.body.expiresAt - Date.now()) / 3_600_000;
    assert.ok(hours > 71.9 && hours <= 72, "срок ссылки — 72 часа");
    const token = tokenFromPath(issued.body.path);

    const visitor = new TestClient(env);
    for (let i = 0; i < 3; i += 1) {
        const view = await visitor.get<{ role: string; companyName: string }>(`/api/invitations/by-token/${token}`);
        assert.equal(view.status, 200);
        assert.equal(view.body.role, "director");
        assert.equal(view.body.companyName, "Альфа");
    }
    const badForm = await visitor.post(`/api/invitations/by-token/${token}/accept`, { displayName: "Д", login: "!", password: "short" });
    assert.equal(badForm.status, 400);
    const shortPassword = await visitor.post(`/api/invitations/by-token/${token}/accept`, { displayName: "Директор", login: "boss", password: "short" });
    assert.equal(shortPassword.status, 400);
    assert.ok(shortPassword.body.error?.fields?.["password"]);

    const ok = await visitor.post(`/api/invitations/by-token/${token}/accept`, { displayName: "Директор Альфы", login: "Boss", password: "very-secret-pass" });
    assert.equal(ok.status, 200);
    const me = await visitor.get<Me>("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, "director");

    const again = await new TestClient(env).post(`/api/invitations/by-token/${token}/accept`, { displayName: "Второй", login: "boss2", password: "very-secret-pass" });
    assert.equal(again.status, 410);
    assert.equal(again.body.error?.code, "invite.used");
    const view = await visitor.get(`/api/invitations/by-token/${token}`);
    assert.equal(view.status, 410);

    const users = env.DB.sqlite.prepare("SELECT login, password_hash FROM users").all() as Array<{ login: string; password_hash: string }>;
    assert.equal(users.length, 1);
    assert.equal(users[0]?.login, "boss", "логин хранится в нижнем регистре");
    assert.match(users[0]!.password_hash, /^pbkdf2-sha256\$100000\$/);
    assert.ok(!users[0]!.password_hash.includes("very-secret-pass"));
});

test("повтор отправки формы регистрации не создаёт второго пользователя", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.9.9.9");
    const issued = await owner.post<{ path: string }>("/api/owner/activation-links", { code: OWNER_CODE });
    const token = tokenFromPath(issued.body.path);
    const a = new TestClient(env);
    const payload = { displayName: "Директор", login: "boss", password: "very-secret-pass" };
    const results = await Promise.all([a.post(`/api/invitations/by-token/${token}/accept`, payload), a.post(`/api/invitations/by-token/${token}/accept`, payload)]);
    const statuses = results.map((result) => result.status).sort();
    assert.equal(statuses[0], 200);
    assert.ok(statuses[1] === 400 || statuses[1] === 410);
    const count = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    assert.equal(count.n, 1);
});

test("вход, выход, отзыв сессий, CSRF-заголовок, ограничение попыток входа", async () => {
    const env = createTestEnv();
    await bootstrapDirector(env, "boss");
    const browser = new TestClient(env, "10.2.2.2");
    const bad = await browser.post("/api/auth/login", { login: "boss", password: "wrong-password" });
    assert.equal(bad.status, 401);
    const unknown = await browser.post("/api/auth/login", { login: "nobody", password: "wrong-password" });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error?.message, bad.body.error?.message, "сообщение не выдаёт, существует ли логин");

    const noCsrf = await browser.request("POST", "/api/auth/login", { login: "boss", password: "director-password-1" }, { csrf: false });
    assert.equal(noCsrf.status, 403);

    const ok = await browser.post("/api/auth/login", { login: "BOSS", password: "director-password-1" });
    assert.equal(ok.status, 200);
    assert.ok(browser.cookies.get("asc_session"));
    const second = new TestClient(env, "10.2.2.3");
    await second.post("/api/auth/login", { login: "boss", password: "director-password-1" });

    const list = await browser.get<{ sessions: Array<{ id: string; current: boolean }> }>("/api/me/sessions");
    assert.equal(list.body.sessions.length, 3, "сессии директора: после активации, browser, second");
    const secondList = await second.get<{ sessions: Array<{ id: string; current: boolean }> }>("/api/me/sessions");
    const secondId = secondList.body.sessions.find((session) => session.current)!.id;
    assert.equal((await browser.delete(`/api/me/sessions/${secondId}`)).status, 200);
    // Отозванная сессия не работает уже со следующего запроса
    assert.equal((await second.get("/api/me")).status, 401);
    assert.equal((await browser.get("/api/me")).status, 200);

    assert.equal((await browser.post("/api/auth/logout")).status, 200);
    assert.equal((await browser.get("/api/me")).status, 401);

    const attacker = new TestClient(env, "10.3.3.3");
    for (let i = 0; i < 10; i += 1) await attacker.post("/api/auth/login", { login: "boss", password: "nope-nope-nope" });
    const blocked = await attacker.post("/api/auth/login", { login: "boss", password: "director-password-1" });
    assert.equal(blocked.status, 429);
});

test("филиалы, приглашения, роли, допуск и изоляция филиалов", async () => {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);

    // Один филиал выбирается автоматически
    const north = await director.post<{ branch: { id: string } }>("/api/branches", { name: "Север", city: "Астана" });
    assert.equal(north.status, 200);
    let me = await director.get<Me>("/api/me");
    assert.equal(me.body.selectedBranchId, north.body.branch.id);
    const south = await director.post<{ branch: { id: string } }>("/api/branches", { name: "Юг", city: "Алматы" });
    const dup = await director.post("/api/branches", { name: "Юг" });
    assert.equal(dup.status, 400);
    me = await director.get<Me>("/api/me");
    assert.equal(me.body.selectedBranchId, "*", "при нескольких филиалах по умолчанию «Все филиалы»");
    assert.equal(me.body.branches.length, 2);

    const northId = north.body.branch.id;
    const southId = south.body.branch.id;

    const manager = await invite(env, director, { role: "manager", branchId: northId }, "north.manager", "Руководитель Севера");
    const employee = await invite(env, manager, { role: "employee" }, "north.employee", "Сотрудник Севера");
    const southEmployee = await invite(env, director, { role: "employee", branchId: southId }, "south.employee", "Сотрудник Юга");

    // Руководитель не может приглашать руководителей и в чужой филиал
    assert.equal((await manager.post("/api/invitations", { role: "manager" })).status, 403);
    const managerInvite = await manager.post<{ path: string }>("/api/invitations", { role: "employee", branchId: southId });
    assert.equal(managerInvite.status, 200);
    const invited = await new TestClient(env).get<{ branchName: string }>(`/api/invitations/by-token/${tokenFromPath(managerInvite.body.path)}`);
    assert.equal(invited.body.branchName, "Север", "руководитель приглашает только в свой филиал");

    // Сотрудник до допуска: только обучение и профиль
    let employeeMe = await employee.get<Me>("/api/me");
    assert.equal(employeeMe.body.user.admitted, false);
    assert.deepEqual(
        Object.entries(employeeMe.body.sections).filter(([, allowed]) => allowed).map(([key]) => key).sort(),
        ["profile", "training"]
    );
    assert.equal((await employee.get("/api/sections/crm")).status, 403);
    assert.equal((await employee.get("/api/sections/kpi")).status, 403);
    assert.equal((await employee.get("/api/sections/training")).status, 200);
    assert.equal((await employee.get("/api/users")).status, 403);
    assert.equal((await employee.post("/api/invitations", { role: "employee" })).status, 403);

    // Руководитель видит только свой филиал
    const managerUsers = await manager.get<{ users: Array<{ id: string; login: string; branchId: string }> }>("/api/users");
    assert.ok(managerUsers.body.users.every((user) => user.branchId === northId));
    assert.equal((await manager.get(`/api/users?branchId=${southId}`)).status, 403);
    const southUserId = (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = 'south.employee'").get() as { id: string }).id;
    const employeeId = (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = 'north.employee'").get() as { id: string }).id;
    assert.equal((await manager.put(`/api/users/${southUserId}/admission`, { admitted: true })).status, 404, "чужой филиал недоступен по прямой ссылке");
    assert.equal((await manager.post(`/api/users/${southUserId}/reset-code`)).status, 404);

    // Допуск открывает CRM и KPI со следующего запроса
    assert.equal((await manager.put(`/api/users/${employeeId}/admission`, { admitted: true })).status, 200);
    employeeMe = await employee.get<Me>("/api/me");
    assert.equal(employeeMe.body.user.admitted, true);
    assert.equal((await employee.get("/api/sections/crm")).status, 200);
    assert.equal((await employee.get("/api/sections/kpi")).status, 200);
    assert.equal((await employee.get("/api/sections/stats")).status, 403);

    // Снятие допуска действует со следующего запроса
    await manager.put(`/api/users/${employeeId}/admission`, { admitted: false });
    assert.equal((await employee.get("/api/sections/crm")).status, 403);

    // Перевод сотрудника: новый филиал со следующего запроса, допуск снимается
    await director.put(`/api/users/${employeeId}/admission`, { admitted: true });
    assert.equal((await manager.patch(`/api/users/${employeeId}`, { branchId: southId })).status, 403, "переводит только директор");
    assert.equal((await director.patch(`/api/users/${employeeId}`, { branchId: southId })).status, 200);
    employeeMe = await employee.get<Me>("/api/me");
    assert.equal(employeeMe.body.user.branchId, southId);
    assert.equal(employeeMe.body.user.admitted, false);
    const managerAfter = await manager.get<{ users: Array<{ id: string }> }>("/api/users");
    assert.ok(!managerAfter.body.users.some((user) => user.id === employeeId), "руководитель прежнего филиала больше не видит сотрудника");

    // Отключение — сессии сотрудника завершаются
    assert.equal((await director.patch(`/api/users/${southUserId}`, { status: "disabled" })).status, 200);
    assert.equal((await southEmployee.get("/api/me")).status, 401);
    const disabledLogin = await new TestClient(env).post("/api/auth/login", { login: "south.employee", password: "employee-password-1" });
    assert.equal(disabledLogin.status, 403);

    // Директор: выбор филиала в шапке, последнего директора нельзя понизить
    assert.equal((await director.put("/api/me/branch", { branchId: southId })).status, 200);
    me = await director.get<Me>("/api/me");
    assert.equal(me.body.selectedBranchId, southId);
    const directorId = (env.DB.sqlite.prepare("SELECT id FROM users WHERE role = 'director'").get() as { id: string }).id;
    assert.equal((await director.patch(`/api/users/${directorId}`, { status: "disabled" })).status, 403, "себя менять нельзя");
    assert.equal((await manager.put("/api/me/branch", { branchId: southId })).status, 403);

    // Отзыв приглашения
    const pending = await director.post<{ path: string; id: string }>("/api/invitations", { role: "employee", branchId: northId });
    assert.equal((await director.post(`/api/invitations/${pending.body.id}/revoke`)).status, 200);
    const revokedView = await new TestClient(env).get(`/api/invitations/by-token/${tokenFromPath(pending.body.path)}`);
    assert.equal(revokedView.status, 410);
    assert.equal(revokedView.body.error?.code, "invite.revoked");
});

test("восстановление пароля по коду от руководителя", async () => {
    const env = createTestEnv();
    const director = await bootstrapDirector(env);
    const branch = await director.post<{ branch: { id: string } }>("/api/branches", { name: "Центр" });
    const manager = await invite(env, director, { role: "manager", branchId: branch.body.branch.id }, "center.manager");
    const employee = await invite(env, manager, { role: "employee" }, "center.employee");
    const employeeId = (env.DB.sqlite.prepare("SELECT id FROM users WHERE login = 'center.employee'").get() as { id: string }).id;

    const issued = await manager.post<{ code: string }>(`/api/users/${employeeId}/reset-code`);
    assert.equal(issued.status, 200);
    assert.match(issued.body.code, /^[A-Z2-9]{10}$/);
    const stored = env.DB.sqlite.prepare("SELECT code_hash FROM password_reset_codes").get() as { code_hash: string };
    assert.notEqual(stored.code_hash, issued.body.code, "код хранится только в виде хэша");

    const anon = new TestClient(env, "10.7.7.7");
    const wrong = await anon.post("/api/auth/reset", { login: "center.employee", code: "AAAAAAAAAA", password: "new-password-123" });
    assert.equal(wrong.status, 400);
    const ok = await anon.post("/api/auth/reset", { login: "center.employee", code: issued.body.code.toLowerCase(), password: "new-password-123" });
    assert.equal(ok.status, 200);
    assert.equal((await employee.get("/api/me")).status, 401, "после сброса прежние сессии завершены");
    const reuse = await anon.post("/api/auth/reset", { login: "center.employee", code: issued.body.code, password: "another-pass-123" });
    assert.equal(reuse.status, 400, "код одноразовый");
    const login = await anon.post("/api/auth/login", { login: "center.employee", password: "new-password-123" });
    assert.equal(login.status, 200);

    // Смена пароля из профиля завершает остальные сессии
    const other = new TestClient(env, "10.7.7.8");
    await other.post("/api/auth/login", { login: "center.employee", password: "new-password-123" });
    const changed = await anon.post("/api/me/password", { currentPassword: "new-password-123", newPassword: "third-password-123" });
    assert.equal(changed.status, 200);
    assert.equal((await other.get("/api/me")).status, 401);
    assert.equal((await anon.get("/api/me")).status, 200);
});

test("настройки системы: срок приглашений, своё имя, подключения без раскрытия секретов", async () => {
    const env = createTestEnv();
    const owner = new TestClient(env, "10.9.9.9");
    const tooLong = await owner.post("/api/owner/activation-links", { code: OWNER_CODE, ttlHours: 500 });
    assert.equal(tooLong.status, 400);
    const short = await owner.post<{ expiresAt: number }>("/api/owner/activation-links", { code: OWNER_CODE, ttlHours: 2 });
    assert.equal(short.status, 200);
    assert.ok(Math.abs(short.body.expiresAt - Date.now() - 2 * 3_600_000) < 60_000, "срок ссылки владельца — заданные 2 часа");

    const director = await bootstrapDirector(env);
    const branch = await director.post<{ branch: { id: string } }>("/api/branches", { name: "Центр" });
    const invitation = await director.post<{ expiresAt: number }>("/api/invitations", { role: "employee", branchId: branch.body.branch.id, ttlHours: 24 });
    assert.ok(Math.abs(invitation.body.expiresAt - Date.now() - 24 * 3_600_000) < 60_000, "срок приглашения — 24 часа");

    assert.equal((await director.patch("/api/me", { displayName: "А" })).status, 400);
    assert.equal((await director.patch("/api/me", { displayName: "Айгерим Новая" })).status, 200);
    const me = await director.get<{ user: { displayName: string }; sections: Record<string, boolean> }>("/api/me");
    assert.equal(me.body.user.displayName, "Айгерим Новая");
    assert.equal(me.body.sections["settings"], true);

    const manager = await invite(env, director, { role: "manager", branchId: branch.body.branch.id }, "center.manager");
    const employee = await invite(env, manager, { role: "employee" }, "center.employee");
    assert.equal((await manager.get("/api/sections/settings")).status, 200, "руководителю доступны участники и приглашения");
    assert.equal((await manager.patch("/api/company", { name: "Взлом", timezone: "UTC" })).status, 403);
    assert.equal((await employee.get("/api/sections/settings")).status, 403);
    assert.equal((await employee.patch("/api/me", { displayName: "Сотрудник Переименованный" })).status, 200, "своё имя меняет любой");
});
