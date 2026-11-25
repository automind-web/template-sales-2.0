import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { applyMigrations, TestD1 } from "./support/d1.ts";

const drizzleDir = new URL("../drizzle/", import.meta.url);

test("миграции применяются с нуля по журналу и создают все таблицы схемы", () => {
    const db = new TestD1();
    const applied = applyMigrations(db);
    assert.ok(applied.length >= 1);
    const tables = (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    for (const table of ["companies", "company_settings", "branches", "users", "sessions", "invitations", "password_reset_codes", "admissions", "rate_limits", "audit_log", "courses", "course_versions", "training_files", "course_assignments", "lesson_progress", "test_attempts", "admission_rules"]) {
        assert.ok(tables.includes(table), `нет таблицы ${table}`);
    }
    const fk = db.sqlite.prepare("PRAGMA foreign_key_check").all();
    assert.equal(fk.length, 0);
});

test("каждый SQL-файл есть в журнале и наоборот", () => {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8")) as { entries: Array<{ tag: string; idx: number }> };
    const files = readdirSync(drizzleDir).filter((file) => file.endsWith(".sql")).sort();
    assert.deepEqual(files, journal.entries.map((entry) => `${entry.tag}.sql`).sort());
    journal.entries.forEach((entry, index) => assert.equal(entry.idx, index, "индексы журнала идут подряд"));
});

test("применённые миграции не изменены (сверка с db/migration-lock.json)", () => {
    const lock = JSON.parse(readFileSync(new URL("../db/migration-lock.json", import.meta.url), "utf8")) as Record<string, string>;
    for (const [file, sha] of Object.entries(lock)) {
        const actual = createHash("sha256").update(readFileSync(new URL(file, drizzleDir))).digest("hex");
        assert.equal(actual, sha, `миграция ${file} изменена; создайте новую миграцию вместо правки`);
    }
    const files = readdirSync(drizzleDir).filter((file) => file.endsWith(".sql"));
    for (const file of files) assert.ok(lock[file], `миграция ${file} не зафиксирована: npm run db:lock`);
});
