import { and, eq, sql } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { branches, companies, leads } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireActor, requireRole, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { AppError, readJson } from "../http.ts";
import { writeSetting } from "../settings-store.ts";
import { employeesSeeBranch, FUNNEL_KEY, getFunnel, SEE_BRANCH_KEY, stageOf, validateFunnel } from "../crm/funnel.ts";
import { assignableOwners, createLead, crmBranch, leadHistory, listLeads, loadLead, parseFilters, toViews, updateLead } from "../crm/leads.ts";

async function companyTimezone(ctx: Ctx, actor: Actor): Promise<string> {
    const company = await ctx.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, actor.companyId)).get();
    return company?.timezone ?? companyConfig.timezone;
}

/** Всё, что нужно экрану CRM: воронка, ответственные филиала, права */
export async function crmConfig(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const branchId = await crmBranch(ctx, actor, ctx.url.searchParams.get("branchId"));
    const branch = await ctx.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId)).get();
    return {
        branch,
        funnel: await getFunnel(ctx.db, actor.companyId),
        owners: await assignableOwners(ctx.db, branchId),
        canAssign: actor.role !== "employee",
        ownOnly: actor.role === "employee" && !(await employeesSeeBranch(ctx.db, actor.companyId)),
        currency: companyConfig.currency,
        timezone: await companyTimezone(ctx, actor),
    };
}

export async function crmList(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const branchId = await crmBranch(ctx, actor, ctx.url.searchParams.get("branchId"));
    return listLeads(ctx, actor, branchId, parseFilters(ctx.url.searchParams), await companyTimezone(ctx, actor));
}

function csvCell(value: string | number | null): string {
    let cell = value === null ? "" : String(value);
    // Защита от формул в Excel: значение, начинающееся с =, +, -, @, выводится как текст.
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    return /[";\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Выгрузка с теми же правами и фильтрами, что и список */
export async function crmExport(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const branchId = await crmBranch(ctx, actor, ctx.url.searchParams.get("branchId"));
    const timeZone = await companyTimezone(ctx, actor);
    const result = await listLeads(ctx, actor, branchId, parseFilters(ctx.url.searchParams), timeZone);
    const format = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const header = ["№", "Клиент", "Телефон", "Компания", "Этап", "Ответственный", "Следующий контакт", "Сумма", "Создан"];
    const lines = result.leads.map((lead) =>
        [
            lead.number,
            lead.clientName,
            lead.clientPhone,
            lead.clientCompany,
            stageOf(result.funnel, lead.stage)?.label ?? lead.stage,
            lead.ownerName,
            lead.nextContactAt ? format.format(new Date(lead.nextContactAt)) : null,
            lead.amount,
            format.format(new Date(lead.createdAt)),
        ]
            .map(csvCell)
            .join(";")
    );
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "crm.export", entityType: "branch", entityId: branchId, data: { count: lines.length } }, ctx.now);
    return new Response(`﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`, {
        headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="leads-${new Date(ctx.now).toISOString().slice(0, 10)}.csv"`,
            "cache-control": "no-store, private",
            "x-content-type-options": "nosniff",
        },
    });
}

async function detail(ctx: Ctx, actor: Actor, leadId: string) {
    const lead = await loadLead(ctx, actor, leadId);
    const funnel = await getFunnel(ctx.db, actor.companyId);
    const [view] = await toViews(ctx.db, [lead], funnel, ctx.now);
    return {
        lead: view,
        history: await leadHistory(ctx.db, lead.id),
        funnel,
        owners: await assignableOwners(ctx.db, lead.branchId),
        canAssign: actor.role !== "employee",
        currency: companyConfig.currency,
    };
}

export async function crmGet(ctx: Ctx) {
    const actor = await requireActor(ctx);
    return detail(ctx, actor, ctx.params["id"] ?? "");
}

export async function crmCreate(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await crmBranch(ctx, actor, typeof body["branchId"] === "string" ? body["branchId"] : null);
    const { lead, repeated } = await createLead(ctx, actor, branchId, body);
    return { repeated, ...(await detail(ctx, actor, lead.id)) };
}

export async function crmUpdate(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const { lead, repeated } = await updateLead(ctx, actor, ctx.params["id"] ?? "", body);
    return { repeated, ...(await detail(ctx, actor, lead.id)) };
}

// --- Настройки процесса (директор) ---------------------------------------

export async function getProcess(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    return {
        funnel: await getFunnel(ctx.db, actor.companyId),
        employeesSeeBranch: await employeesSeeBranch(ctx.db, actor.companyId),
    };
}

export async function saveProcess(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const body = await readJson(ctx.request);
    if ("funnel" in body) {
        const funnel = validateFunnel(body["funnel"]);
        const used = await ctx.db
            .select({ stage: leads.stage, total: sql<number>`count(*)` })
            .from(leads)
            .where(and(eq(leads.companyId, actor.companyId)))
            .groupBy(leads.stage)
            .all();
        for (const row of used) {
            if (!stageOf(funnel, row.stage)) throw new AppError(400, "crm.funnelStageInUse", { vars: { stage: row.stage } });
        }
        await writeSetting(ctx.db, actor.companyId, FUNNEL_KEY, funnel, actor.userId, ctx.now);
    }
    if ("employeesSeeBranch" in body) {
        await writeSetting(ctx.db, actor.companyId, SEE_BRANCH_KEY, body["employeesSeeBranch"] === true, actor.userId, ctx.now);
    }
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "settings.process", entityType: "company", entityId: actor.companyId }, ctx.now);
    return getProcess(ctx);
}
