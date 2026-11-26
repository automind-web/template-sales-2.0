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

// ---------------------------------------------------------------------------
// Этап 2. Обучение
// ---------------------------------------------------------------------------

/** Курс (программа обучения). Ключ стабилен и используется в правилах допуска. */
export const courses = sqliteTable("courses", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    archivedAt: integer("archived_at"),
}, (t) => [uniqueIndex("courses_company_key_unique").on(t.companyId, t.key)]);

/**
 * Утверждённая редакция материалов курса. Строка неизменяема: новая редакция —
 * новая строка с version + 1. content — JSON с уроками и тестом (с ответами).
 */
export const courseVersions = sqliteTable("course_versions", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    checksum: text("checksum").notNull(),
    /** Идентификатор редакции во внешней системе: повторная доставка не создаёт новую версию */
    externalRef: text("external_ref"),
    source: text("source", { enum: ["integration"] }).notNull(),
    createdAt: integer("created_at").notNull(),
}, (t) => [
    uniqueIndex("course_versions_course_version_unique").on(t.courseId, t.version),
    uniqueIndex("course_versions_course_ref_unique").on(t.courseId, t.externalRef),
]);

/** Файлы материалов: содержимое в R2, метаданные здесь */
export const trainingFiles = sqliteTable("training_files", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at").notNull(),
}, (t) => [
    uniqueIndex("training_files_object_key_unique").on(t.objectKey),
    index("training_files_course_idx").on(t.courseId),
]);

/** Назначение курса: всем сотрудникам компании, сотрудникам филиала или конкретному человеку */
export const courseAssignments = sqliteTable("course_assignments", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    scope: text("scope", { enum: ["company", "branch", "user"] }).notNull(),
    branchId: text("branch_id").references(() => branches.id),
    userId: text("user_id").references(() => users.id),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    removedAt: integer("removed_at"),
}, (t) => [index("course_assignments_company_idx").on(t.companyId, t.courseId)]);

export const lessonProgress = sqliteTable("lesson_progress", {
    userId: text("user_id").notNull().references(() => users.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    lessonKey: text("lesson_key").notNull(),
    courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
    completedAt: integer("completed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.courseId, t.lessonKey] })]);

/**
 * Попытка теста. Версия закрепляется при старте: начатый тест завершается по
 * своей редакции, новая редакция применяется со следующей попытки.
 * Одновременно у сотрудника не больше одной незавершённой попытки по курсу.
 */
export const testAttempts = sqliteTable("test_attempts", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    userId: text("user_id").notNull().references(() => users.id),
    branchId: text("branch_id"),
    courseId: text("course_id").notNull().references(() => courses.id),
    courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
    status: text("status", { enum: ["in_progress", "submitted"] }).notNull(),
    answers: text("answers").notNull().default("{}"),
    startedAt: integer("started_at").notNull(),
    submittedAt: integer("submitted_at"),
    correctCount: integer("correct_count"),
    totalCount: integer("total_count"),
    scorePercent: integer("score_percent"),
    minScorePercent: integer("min_score_percent"),
    passed: integer("passed", { mode: "boolean" }),
}, (t) => [
    uniqueIndex("test_attempts_one_open_unique").on(t.userId, t.courseId).where(sql`status = 'in_progress'`),
    index("test_attempts_company_branch_idx").on(t.companyId, t.branchId),
    index("test_attempts_user_course_idx").on(t.userId, t.courseId),
]);

/**
 * Правила допуска к CRM: какой курс и какой минимальный результат нужен.
 * branch_id = null — правило для всех филиалов; правила филиала заменяют общие.
 * Пока директор не сохранил свои правила, действуют правила из config/company.ts.
 */
export const admissionRules = sqliteTable("admission_rules", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    role: text("role", { enum: ["employee"] }).notNull(),
    branchId: text("branch_id").references(() => branches.id),
    courseKey: text("course_key").notNull(),
    minScorePercent: integer("min_score_percent").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    removedAt: integer("removed_at"),
}, (t) => [index("admission_rules_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Этап 3–4. CRM
// ---------------------------------------------------------------------------

/**
 * Лид (сделка) воронки филиала. Запись защищена номером версии: изменение
 * принимается, только если клиент прислал текущую версию. last_op_id — последняя
 * применённая операция (повтор той же операции второго события не создаёт).
 */
export const leads = sqliteTable("leads", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    /** Сквозной номер лида в компании (#12) */
    number: integer("number").notNull(),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone"),
    clientCompany: text("client_company"),
    source: text("source", { enum: ["manual", "whatsapp"] }).notNull().default("manual"),
    stage: text("stage").notNull(),
    /** Ответственный; null — не назначен (например, лид из WhatsApp) */
    ownerUserId: text("owner_user_id").references(() => users.id),
    nextContactAt: integer("next_contact_at"),
    amount: integer("amount"),
    lostReason: text("lost_reason"),
    /** Строка поиска в нижнем регистре: номер, клиент, телефон, компания */
    searchText: text("search_text").notNull(),
    version: integer("version").notNull().default(1),
    lastOpId: text("last_op_id"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    stageChangedAt: integer("stage_changed_at").notNull(),
    /** Момент перехода в конечный этап (сделка или отказ) и ответственный на тот момент */
    closedAt: integer("closed_at"),
    closedOwnerUserId: text("closed_owner_user_id"),
}, (t) => [
    uniqueIndex("leads_company_number_unique").on(t.companyId, t.number),
    index("leads_branch_stage_idx").on(t.branchId, t.stage),
    index("leads_branch_owner_idx").on(t.branchId, t.ownerUserId),
    index("leads_branch_next_contact_idx").on(t.branchId, t.nextContactAt),
    index("leads_company_closed_idx").on(t.companyId, t.closedAt),
    index("leads_company_created_idx").on(t.companyId, t.createdAt),
    index("leads_branch_phone_idx").on(t.branchId, t.clientPhone),
]);

/** История лида: кто, когда, что было и что стало */
export const leadEvents = sqliteTable("lead_events", {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => leads.id),
    companyId: text("company_id").notNull(),
    branchId: text("branch_id").notNull(),
    type: text("type", { enum: ["created", "stage", "owner", "next_contact", "field", "comment"] }).notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actorUserId: text("actor_user_id"),
    opId: text("op_id"),
    createdAt: integer("created_at").notNull(),
}, (t) => [index("lead_events_lead_idx").on(t.leadId, t.createdAt)]);

/** Применённые операции: повтор нажатия или доставки возвращает тот же результат */
export const leadOperations = sqliteTable("lead_operations", {
    opId: text("op_id").primaryKey(),
    leadId: text("lead_id").notNull(),
    userId: text("user_id"),
    createdAt: integer("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Этап 5. KPI
// ---------------------------------------------------------------------------

/**
 * Версия методики KPI: набор показателей с формулами из полей CRM.
 * scope — 'company' или id филиала (методика филиала заменяет общую).
 * Утверждённая версия действует с момента утверждения: прошлые периоды
 * считаются по версии, утверждённой до их окончания, и не переписываются.
 */
export const kpiVersions = sqliteTable("kpi_versions", {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    scope: text("scope").notNull(),
    version: integer("version").notNull(),
    status: text("status", { enum: ["draft", "approved"] }).notNull(),
    indicators: text("indicators").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at"),
}, (t) => [
    uniqueIndex("kpi_versions_scope_version_unique").on(t.companyId, t.scope, t.version),
    index("kpi_versions_approved_idx").on(t.companyId, t.scope, t.approvedAt),
]);
