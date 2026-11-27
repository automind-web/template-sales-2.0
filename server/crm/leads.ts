/**
 * CRM: права на лиды, список, создание, изменение, комментарии и история.
 *
 * Правила записи:
 * - сначала права пользователя, потом данные (филиал, «только свои»);
 * - изменение принимается только при совпадении номера версии;
 * - повтор операции (тот же opId) не создаёт второго события и возвращает результат;
 * - переход этапа проверяется по воронке, обязательные поля — по целевому этапу.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { FunnelConfig } from "../../config/company.ts";
import { admissions, branches, leadEvents, leadOperations, leads, users } from "../../db/schema.ts";
import { resolveBranchScope } from "../access.ts";
import type { Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { isUniqueViolation, newId, type Db } from "../db.ts";
import { AppError } from "../http.ts";
import { todayBounds } from "../../lib/time.ts";
import { canTransition, employeesSeeBranch, getFunnel, isTerminal, stageOf, type RequiredField } from "./funnel.ts";

export type LeadRow = typeof leads.$inferSelect;

export const LIMITS = { name: 120, phone: 32, company: 120, lostReason: 300, comment: 4000, amount: 1_000_000_000_000 };

// --- Права ---------------------------------------------------------------

export function requireCrm(actor: Actor) {
    // Сотрудник — только после допуска; руководитель и директор — всегда.
    if (!actor.admitted) throw new AppError(403, "shell.sectionLocked");
}

export async function canSeeLead(db: Db, actor: Actor, lead: LeadRow): Promise<boolean> {
    if (lead.companyId !== actor.companyId) return false;
    if (actor.role === "director") return true;
    if (lead.branchId !== actor.branchId) return false;
    if (actor.role === "manager") return true;
    return lead.ownerUserId === actor.userId || (await employeesSeeBranch(db, actor.companyId));
}

/** Лид по id с проверкой прав; чужой лид выглядит как несуществующий */
export async function loadLead(ctx: Ctx, actor: Actor, id: string): Promise<LeadRow> {
    requireCrm(actor);
    const lead = await ctx.db.select().from(leads).where(eq(leads.id, id)).get();
    if (!lead || !(await canSeeLead(ctx.db, actor, lead))) throw new AppError(404, "crm.leadNotFound");
    return lead;
}

/** Филиал работы в CRM: директор — один выбранный филиал, остальные — свой */
export async function crmBranch(ctx: Ctx, actor: Actor, requested: string | null): Promise<string> {
    requireCrm(actor);
    const scope = await resolveBranchScope(ctx, actor, requested, { allowAll: false });
    if (scope.kind !== "one") throw new AppError(400, "shell.selectBranchForCrm");
    return scope.branchId;
}

/** Кому можно поручить лид: активные руководители и допущенные сотрудники филиала */
export async function assignableOwners(db: Db, branchId: string) {
    const rows = await db
        .select({ id: users.id, displayName: users.displayName, role: users.role })
        .from(users)
        .where(and(eq(users.branchId, branchId), eq(users.status, "active"), inArray(users.role, ["manager", "employee"])))
        .orderBy(users.displayName)
        .all();
    const employeeIds = rows.filter((row) => row.role === "employee").map((row) => row.id);
    const admitted = employeeIds.length
        ? new Set(
              (
                  await db
                      .select({ userId: admissions.userId })
                      .from(admissions)
                      .where(and(inArray(admissions.userId, employeeIds), isNull(admissions.revokedAt)))
                      .all()
              ).map((row) => row.userId)
          )
        : new Set<string>();
    return rows.filter((row) => row.role === "manager" || admitted.has(row.id));
}

// --- Значения ------------------------------------------------------------

export function normalizePhone(value: string): string {
    const trimmed = value.trim();
    const digits = trimmed.replace(/\D/g, "");
    return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function buildSearchText(number: number, name: string, phone: string | null, company: string | null): string {
    return [`#${number}`, String(number), name, phone ?? "", (phone ?? "").replace(/\D/g, ""), company ?? ""].join(" ").toLocaleLowerCase("ru");
}

function text(value: unknown, field: string, max: number, required = false): string | null {
    if (value === undefined || value === null || value === "") {
        if (required) throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.required" } });
        return null;
    }
    if (typeof value !== "string") throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.invalidInput" } });
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length > max) throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.tooLong" } });
    if (required && !trimmed) throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.required" } });
    return trimmed || null;
}

function multiline(value: unknown, field: string, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.invalidInput" } });
    const trimmed = value.trim();
    if (trimmed.length > max) throw new AppError(400, "validation.invalidInput", { fields: { [field]: "validation.tooLong" } });
    return trimmed || null;
}

function amountValue(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const number = typeof value === "string" ? Number(value.replace(/\s/g, "")) : value;
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > LIMITS.amount) {
        throw new AppError(400, "validation.invalidInput", { fields: { amount: "crm.amountInvalid" } });
    }
    return Math.round(number);
}

function timeValue(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < Date.UTC(2000, 0, 1) || value > Date.UTC(2100, 0, 1)) {
        throw new AppError(400, "validation.invalidInput", { fields: { nextContactAt: "crm.dateInvalid" } });
    }
    return Math.floor(value);
}

function opIdValue(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw new AppError(400, "crm.opIdRequired");
    return value;
}

// --- Представление -------------------------------------------------------

export type LeadView = {
    id: string;
    number: number;
    branchId: string;
    branchName: string | null;
    clientName: string;
    clientPhone: string | null;
    clientCompany: string | null;
    source: "manual" | "whatsapp";
    stage: string;
    ownerUserId: string | null;
    ownerName: string | null;
    nextContactAt: number | null;
    amount: number | null;
    lostReason: string | null;
    version: number;
    createdAt: number;
    updatedAt: number;
    closedAt: number | null;
    overdue: boolean;
};

async function namesFor(db: Db, ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, unique)).all();
    return new Map(rows.map((row) => [row.id, row.name]));
}

export async function toViews(db: Db, rows: LeadRow[], funnel: FunnelConfig, now: number): Promise<LeadView[]> {
    const branchIds = [...new Set(rows.map((row) => row.branchId))];
    const [names, branchRows] = await Promise.all([
        namesFor(db, rows.map((row) => row.ownerUserId)),
        branchIds.length ? db.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, branchIds)).all() : Promise.resolve([]),
    ]);
    const branchNames = new Map(branchRows.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
        id: row.id,
        number: row.number,
        branchId: row.branchId,
        branchName: branchNames.get(row.branchId) ?? null,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        clientCompany: row.clientCompany,
        source: row.source,
        stage: row.stage,
        ownerUserId: row.ownerUserId,
        ownerName: row.ownerUserId ? (names.get(row.ownerUserId) ?? null) : null,
        nextContactAt: row.nextContactAt,
        amount: row.amount,
        lostReason: row.lostReason,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        closedAt: row.closedAt,
        overdue: row.nextContactAt !== null && row.nextContactAt < now && !isTerminal(funnel, row.stage),
    }));
}

// --- Список --------------------------------------------------------------

export type LeadFilters = {
    q: string;
    stages: string[];
    owner: string | null;
    due: "any" | "overdue" | "today" | "week" | "none";
    mine: boolean;
};

export function parseFilters(params: URLSearchParams): LeadFilters {
    const due = params.get("due");
    return {
        q: (params.get("q") ?? "").trim().slice(0, 100),
        stages: (params.get("stage") ?? "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20),
        owner: params.get("owner") || null,
        due: due === "overdue" || due === "today" || due === "week" || due === "none" ? due : "any",
        mine: params.get("mine") === "1",
    };
}

/**
 * Один запрос для списка и канбана: одинаковые права, поиск и фильтры.
 * Возвращает лиды, количество по этапам (без учёта фильтра этапа) и итог.
 */
export async function listLeads(ctx: Ctx, actor: Actor, branchId: string, filters: LeadFilters, timeZone: string) {
    const funnel = await getFunnel(ctx.db, actor.companyId);
    const terminalKeys = funnel.stages.filter((stage) => stage.terminal).map((stage) => stage.key);
    const base: SQL[] = [eq(leads.companyId, actor.companyId), eq(leads.branchId, branchId)];
    const ownOnly = actor.role === "employee" && !(await employeesSeeBranch(ctx.db, actor.companyId));
    if (ownOnly || filters.mine) base.push(eq(leads.ownerUserId, actor.userId));
    if (filters.owner === "none") base.push(isNull(leads.ownerUserId));
    else if (filters.owner === "me") base.push(eq(leads.ownerUserId, actor.userId));
    else if (filters.owner) base.push(eq(leads.ownerUserId, filters.owner));
    if (filters.q) {
        const needle = filters.q.toLocaleLowerCase("ru").replace(/^#/, "").replace(/[%_\\]/g, (char) => `\\${char}`);
        base.push(sql`${leads.searchText} LIKE ${`%${needle}%`} ESCAPE '\\'`);
    }
    const open = terminalKeys.length ? sql`${leads.stage} NOT IN (${sql.join(terminalKeys.map((key) => sql`${key}`), sql`, `)})` : sql`1 = 1`;
    if (filters.due === "overdue") base.push(and(lt(leads.nextContactAt, ctx.now), open)!);
    if (filters.due === "today") {
        const today = todayBounds(timeZone, ctx.now);
        base.push(and(gte(leads.nextContactAt, today.from), lt(leads.nextContactAt, today.to))!);
    }
    if (filters.due === "week") base.push(and(gte(leads.nextContactAt, todayBounds(timeZone, ctx.now).from), lt(leads.nextContactAt, ctx.now + 7 * 86_400_000))!);
    if (filters.due === "none") base.push(isNull(leads.nextContactAt), open);

    const conditions = [...base];
    if (filters.stages.length) conditions.push(inArray(leads.stage, filters.stages));
    // Количество по этапам и сами заявки — параллельно.
    const [countRows, rows] = await Promise.all([
        ctx.db
            .select({ stage: leads.stage, total: sql<number>`count(*)` })
            .from(leads)
            .where(and(...base))
            .groupBy(leads.stage)
            .all(),
        ctx.db
            .select()
            .from(leads)
            .where(and(...conditions))
            .orderBy(sql`${leads.closedAt} IS NOT NULL`, sql`${leads.nextContactAt} IS NULL`, asc(leads.nextContactAt), desc(leads.number))
            .limit(1000)
            .all(),
    ]);
    const counts = Object.fromEntries(funnel.stages.map((stage) => [stage.key, Number(countRows.find((row) => row.stage === stage.key)?.total ?? 0)]));
    return { funnel, counts, total: rows.length, leads: await toViews(ctx.db, rows, funnel, ctx.now) };
}

// --- Создание ------------------------------------------------------------

export async function createLead(ctx: Ctx, actor: Actor, branchId: string, body: Record<string, unknown>) {
    const opId = opIdValue(body["opId"]);
    const repeated = await ctx.db.select().from(leadOperations).where(eq(leadOperations.opId, opId)).get();
    if (repeated) return { lead: await loadLead(ctx, actor, repeated.leadId), repeated: true };

    const funnel = await getFunnel(ctx.db, actor.companyId);
    const clientName = text(body["clientName"], "clientName", LIMITS.name, true)!;
    const phoneRaw = text(body["clientPhone"], "clientPhone", LIMITS.phone);
    const clientPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const clientCompany = text(body["clientCompany"], "clientCompany", LIMITS.company);
    const amount = amountValue(body["amount"]);
    const nextContactAt = timeValue(body["nextContactAt"]);
    const comment = multiline(body["comment"], "comment", LIMITS.comment);

    let ownerUserId: string | null = actor.role === "employee" ? actor.userId : null;
    if (actor.role !== "employee" && body["ownerUserId"]) {
        const owner = String(body["ownerUserId"]);
        const owners = await assignableOwners(ctx.db, branchId);
        if (!owners.some((item) => item.id === owner)) throw new AppError(400, "crm.ownerInvalid", { fields: { ownerUserId: "crm.ownerInvalid" } });
        ownerUserId = owner;
    }
    const stage = funnel.stages[0]!.key;
    const id = newId();
    const d1 = ctx.env.DB;
    const events = [
        d1
            .prepare("INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at) VALUES (?, ?, ?, ?, 'created', NULL, NULL, ?, ?, ?, ?)")
            .bind(newId(), id, actor.companyId, branchId, stage, actor.userId, opId, ctx.now),
    ];
    if (comment) {
        events.push(
            d1
                .prepare("INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at) VALUES (?, ?, ?, ?, 'comment', NULL, NULL, ?, ?, ?, ?)")
                .bind(newId(), id, actor.companyId, branchId, comment, actor.userId, opId, ctx.now)
        );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            // Номер — следующий в компании; уникальный индекс защищает от гонки, при ней повторяем.
            await d1.batch([
                d1
                    .prepare(
                        `INSERT INTO leads (id, company_id, branch_id, number, client_name, client_phone, client_company, source, stage, owner_user_id, next_contact_at, amount, lost_reason, search_text, version, last_op_id, created_by, created_at, updated_at, stage_changed_at)
                         SELECT ?, ?, ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, 'manual', ?, ?, ?, ?, NULL, '', 1, ?, ?, ?, ?, ? FROM leads WHERE company_id = ?`
                    )
                    .bind(id, actor.companyId, branchId, clientName, clientPhone, clientCompany, stage, ownerUserId, nextContactAt, amount, opId, actor.userId, ctx.now, ctx.now, ctx.now, actor.companyId),
                ...events,
                d1.prepare("INSERT INTO lead_operations (op_id, lead_id, user_id, created_at) VALUES (?, ?, ?, ?)").bind(opId, id, actor.userId, ctx.now),
            ]);
            break;
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            const done = await ctx.db.select().from(leadOperations).where(eq(leadOperations.opId, opId)).get();
            if (done) return { lead: await loadLead(ctx, actor, done.leadId), repeated: true };
            if (attempt === 2) throw error;
        }
    }
    const created = await ctx.db.select().from(leads).where(eq(leads.id, id)).get();
    if (!created) throw new AppError(500, "error.internal");
    await ctx.db.update(leads).set({ searchText: buildSearchText(created.number, clientName, clientPhone, clientCompany) }).where(eq(leads.id, id));
    return { lead: { ...created, searchText: buildSearchText(created.number, clientName, clientPhone, clientCompany) }, repeated: false };
}

// --- Изменение -----------------------------------------------------------

type Change = { type: "stage" | "owner" | "next_contact" | "field"; field: string; oldValue: string | null; newValue: string | null };

const str = (value: number | string | null) => (value === null ? null : String(value));

export function missingRequired(funnel: FunnelConfig, stageKey: string, values: { amount: number | null; nextContactAt: number | null; lostReason: string | null; comment: string | null }): RequiredField[] {
    const stage = stageOf(funnel, stageKey);
    return (stage?.requiredFields ?? []).filter((field) => {
        if (field === "amount") return values.amount === null;
        if (field === "nextContactAt") return values.nextContactAt === null;
        if (field === "lostReason") return !values.lostReason;
        return !values.comment;
    });
}

/**
 * Изменение лида. body: { opId, version, changes: {...}, comment? }.
 * Конфликт версий → 409 с актуальным лидом; запрещённый переход → 422;
 * не хватает обязательных полей → 422 со списком полей.
 */
export async function updateLead(ctx: Ctx, actor: Actor, leadId: string, body: Record<string, unknown>) {
    const lead = await loadLead(ctx, actor, leadId);
    const opId = opIdValue(body["opId"]);
    const funnel = await getFunnel(ctx.db, actor.companyId);

    const repeated = await ctx.db.select().from(leadOperations).where(eq(leadOperations.opId, opId)).get();
    if (repeated) return { lead, repeated: true };

    const changesRaw = (typeof body["changes"] === "object" && body["changes"] !== null ? body["changes"] : {}) as Record<string, unknown>;
    const comment = multiline(body["comment"], "comment", LIMITS.comment);
    const next = {
        stage: lead.stage,
        ownerUserId: lead.ownerUserId,
        nextContactAt: lead.nextContactAt,
        amount: lead.amount,
        lostReason: lead.lostReason,
        clientName: lead.clientName,
        clientPhone: lead.clientPhone,
        clientCompany: lead.clientCompany,
    };
    if ("stage" in changesRaw) {
        const target = String(changesRaw["stage"]);
        if (!stageOf(funnel, target)) throw new AppError(400, "crm.stageUnknown");
        next.stage = target;
    }
    if ("ownerUserId" in changesRaw) {
        const owner = changesRaw["ownerUserId"] === null || changesRaw["ownerUserId"] === "" ? null : String(changesRaw["ownerUserId"]);
        if (owner !== lead.ownerUserId) {
            if (actor.role === "employee") throw new AppError(403, "crm.ownerForbidden");
            if (owner !== null && !(await assignableOwners(ctx.db, lead.branchId)).some((item) => item.id === owner)) {
                throw new AppError(400, "crm.ownerInvalid", { fields: { ownerUserId: "crm.ownerInvalid" } });
            }
        }
        next.ownerUserId = owner;
    }
    if ("nextContactAt" in changesRaw) next.nextContactAt = timeValue(changesRaw["nextContactAt"]);
    if ("amount" in changesRaw) next.amount = amountValue(changesRaw["amount"]);
    if ("lostReason" in changesRaw) next.lostReason = text(changesRaw["lostReason"], "lostReason", LIMITS.lostReason);
    if ("clientName" in changesRaw) next.clientName = text(changesRaw["clientName"], "clientName", LIMITS.name, true)!;
    if ("clientPhone" in changesRaw) {
        const phone = text(changesRaw["clientPhone"], "clientPhone", LIMITS.phone);
        next.clientPhone = phone ? normalizePhone(phone) : null;
    }
    if ("clientCompany" in changesRaw) next.clientCompany = text(changesRaw["clientCompany"], "clientCompany", LIMITS.company);

    if (next.stage !== lead.stage) {
        if (!canTransition(funnel, lead.stage, next.stage)) {
            throw new AppError(422, "crm.transitionForbidden", { vars: { from: stageOf(funnel, lead.stage)?.label ?? lead.stage, to: stageOf(funnel, next.stage)?.label ?? next.stage } });
        }
        const missing = missingRequired(funnel, next.stage, { ...next, comment });
        if (missing.length) {
            throw new AppError(422, "crm.requiredFields", {
                vars: { stage: stageOf(funnel, next.stage)?.label ?? next.stage },
                fields: Object.fromEntries(missing.map((field) => [field, "validation.required" as const])),
                extra: { missing },
            });
        }
    }

    const changes: Change[] = [];
    if (next.stage !== lead.stage) changes.push({ type: "stage", field: "stage", oldValue: lead.stage, newValue: next.stage });
    if (next.ownerUserId !== lead.ownerUserId) changes.push({ type: "owner", field: "ownerUserId", oldValue: lead.ownerUserId, newValue: next.ownerUserId });
    if (next.nextContactAt !== lead.nextContactAt) changes.push({ type: "next_contact", field: "nextContactAt", oldValue: str(lead.nextContactAt), newValue: str(next.nextContactAt) });
    for (const field of ["amount", "lostReason", "clientName", "clientPhone", "clientCompany"] as const) {
        if (next[field] !== lead[field]) changes.push({ type: "field", field, oldValue: str(lead[field]), newValue: str(next[field]) });
    }
    if (changes.length === 0 && !comment) return { lead, repeated: false };
    // Номер версии защищает поля лида. Комментарий поля не меняет и с правками не конфликтует.
    if (changes.length > 0) {
        const version = body["version"];
        if (typeof version !== "number" || !Number.isInteger(version)) throw new AppError(400, "crm.versionRequired");
        if (version !== lead.version) {
            throw new AppError(409, "crm.conflict", { extra: { lead: (await toViews(ctx.db, [lead], funnel, ctx.now))[0] } });
        }
    }

    const closing = next.stage !== lead.stage && isTerminal(funnel, next.stage);
    const reopening = next.stage !== lead.stage && !isTerminal(funnel, next.stage) && lead.closedAt !== null;
    const set: Array<[string, unknown]> = [
        ["stage", next.stage],
        ["owner_user_id", next.ownerUserId],
        ["next_contact_at", next.nextContactAt],
        ["amount", next.amount],
        ["lost_reason", next.lostReason],
        ["client_name", next.clientName],
        ["client_phone", next.clientPhone],
        ["client_company", next.clientCompany],
        ["search_text", buildSearchText(lead.number, next.clientName, next.clientPhone, next.clientCompany)],
        ["updated_at", ctx.now],
        ["last_op_id", opId],
    ];
    if (next.stage !== lead.stage) set.push(["stage_changed_at", ctx.now]);
    if (closing) set.push(["closed_at", ctx.now], ["closed_owner_user_id", next.ownerUserId]);
    if (reopening) set.push(["closed_at", null], ["closed_owner_user_id", null]);

    const d1 = ctx.env.DB;
    const newVersion = lead.version + 1;
    const applied = "WHERE id = ? AND last_op_id = ? AND version = ?";
    const eventStatements = [
        ...changes.map((change) =>
            d1
                .prepare(
                    `INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at)
                     SELECT ?, id, company_id, branch_id, ?, ?, ?, ?, ?, ?, ? FROM leads ${applied}`
                )
                .bind(newId(), change.type, change.field, change.oldValue, change.newValue, actor.userId, opId, ctx.now, lead.id, opId, newVersion)
        ),
        ...(comment
            ? [
                  d1
                      .prepare(
                          `INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at)
                           SELECT ?, id, company_id, branch_id, 'comment', NULL, NULL, ?, ?, ?, ? FROM leads ${applied}`
                      )
                      .bind(newId(), comment, actor.userId, opId, ctx.now, lead.id, opId, newVersion),
              ]
            : []),
    ];
    try {
        await d1.batch([
            d1
                .prepare(`UPDATE leads SET ${set.map(([column]) => `${column} = ?`).join(", ")}, version = version + 1 WHERE id = ? AND version = ?`)
                .bind(...set.map(([, value]) => value), lead.id, lead.version),
            ...eventStatements,
            d1.prepare(`INSERT INTO lead_operations (op_id, lead_id, user_id, created_at) SELECT ?, id, ?, ? FROM leads ${applied}`).bind(opId, actor.userId, ctx.now, lead.id, opId, newVersion),
        ]);
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
    }
    const fresh = await ctx.db.select().from(leads).where(eq(leads.id, lead.id)).get();
    if (fresh && fresh.lastOpId === opId) return { lead: fresh, repeated: false };
    const done = await ctx.db.select().from(leadOperations).where(eq(leadOperations.opId, opId)).get();
    if (done && fresh) return { lead: fresh, repeated: true };
    // Кто-то успел изменить лид между чтением и записью.
    throw new AppError(409, "crm.conflict", { extra: { lead: fresh ? (await toViews(ctx.db, [fresh], funnel, ctx.now))[0] : null } });
}

// --- История -------------------------------------------------------------

export async function leadHistory(db: Db, leadId: string) {
    const rows = await db.select().from(leadEvents).where(eq(leadEvents.leadId, leadId)).orderBy(desc(leadEvents.createdAt), desc(leadEvents.id)).limit(500).all();
    const ownerIds = rows.flatMap((row) => (row.type === "owner" ? [row.oldValue, row.newValue] : []));
    const names = await namesFor(db, [...rows.map((row) => row.actorUserId), ...ownerIds]);
    return rows.map((row) => ({
        id: row.id,
        type: row.type,
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        oldLabel: row.type === "owner" && row.oldValue ? (names.get(row.oldValue) ?? null) : null,
        newLabel: row.type === "owner" && row.newValue ? (names.get(row.newValue) ?? null) : null,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
        createdAt: row.createdAt,
    }));
}
