/**
 * Схема БД (D1 / SQLite) в Drizzle.
 *
 * Правило: применённые миграции не правятся. Любое изменение схемы —
 * новая миграция `npm run db:generate -- --name <описание>`.
 *
 * Время хранится в миллисекундах UNIX (integer). Идентификаторы — UUID (text).
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const ROLES = ["director", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

const nowMs = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

export const companies = sqliteTable("companies", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Asia/Almaty"),
    locale: text("locale").notNull().default("ru"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
});

/** Настройки компании, переопределяющие config/company.ts (воронка, правила допуска и т. п.) */
export const companySettings = sqliteTable("company_settings", {
    companyId: text("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    updatedBy: text("updated_by"),
}, (t) => [primaryKey({ columns: [t.companyId, t.key] })]);

export const branches = sqliteTable("branches", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    city: text("city"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    createdBy: text("created_by"),
}, (t) => [
    uniqueIndex("branches_company_name_unique").on(t.companyId, t.name),
]);

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    /** Логин в нижнем регистре, уникален на весь сайт */
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    /** null только у директора */
    branchId: text("branch_id").references(() => branches.id),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
    lastLoginAt: integer("last_login_at"),
}, (t) => [
    uniqueIndex("users_login_unique").on(t.login),
    index("users_company_branch_idx").on(t.companyId, t.branchId),
]);

export const sessions = sqliteTable("sessions", {
    /** SHA-256 от значения cookie; само значение в БД не хранится */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgent: text("user_agent"),
    /** Выбранный директором филиал; '*' — «Все филиалы» */
    selectedBranchId: text("selected_branch_id"),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/**
 * Приглашения и ссылки активации директора.
 * Открытие и ошибки формы приглашение не гасят; гасит только успешная регистрация.
 */
export const invitations = sqliteTable("invitations", {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["activation", "invite"] }).notNull(),
    companyId: text("company_id").notNull().references(() => companies.id),
    branchId: text("branch_id").references(() => branches.id),
    role: text("role", { enum: ROLES }).notNull(),
    /** SHA-256 от токена из ссылки */
    tokenHash: text("token_hash").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    usedByUserId: text("used_by_user_id"),
    /** Одноразовый маркер, которым помечается погашение (защита от двойной регистрации) */
    consumeNonce: text("consume_nonce"),
    revokedAt: integer("revoked_at"),
    revokedBy: text("revoked_by"),
}, (t) => [
    uniqueIndex("invitations_token_hash_unique").on(t.tokenHash),
    index("invitations_company_idx").on(t.companyId, t.branchId),
]);

export const passwordResetCodes = sqliteTable("password_reset_codes", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    codeHash: text("code_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    attempts: integer("attempts").notNull().default(0),
}, (t) => [index("password_reset_codes_user_idx").on(t.userId)]);

/** Допуск сотрудника к CRM. Активен, пока revoked_at пуст. */
export const admissions = sqliteTable("admissions", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    userId: text("user_id").notNull().references(() => users.id),
    source: text("source", { enum: ["test", "manual"] }).notNull(),
    sourceRef: text("source_ref"),
    grantedBy: text("granted_by"),
    grantedAt: integer("granted_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedBy: text("revoked_by"),
    reason: text("reason"),
}, (t) => [index("admissions_user_idx").on(t.userId)]);

/** Счётчики ограничения частоты (вход, код владельца, восстановление пароля) */
export const rateLimits = sqliteTable("rate_limits", {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
    id: text("id").primaryKey(),
    companyId: text("company_id"),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: text("data"),
    createdAt: integer("created_at").notNull(),
}, (t) => [index("audit_log_company_idx").on(t.companyId, t.createdAt)]);
