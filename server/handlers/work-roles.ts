/**
 * Рабочие роли (должности): директор создаёт, руководитель и директор назначают людям.
 * Роль задаёт, какие рабочие разделы открыты (CRM, KPI, статистика) — только сужает права.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { users, workRoles } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { parseSections, requireActor, requireRole, WORK_SECTIONS } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { newId } from "../db.ts";
import { AppError, badRequest, readJson, str } from "../http.ts";

function readSections(body: Record<string, unknown>): string[] {
    const raw = body["sections"];
    if (!Array.isArray(raw)) throw badRequest("validation.invalidInput", { sections: "validation.invalidInput" });
    return [...new Set(raw.filter((item): item is string => typeof item === "string" && (WORK_SECTIONS as readonly string[]).includes(item)))];
}

export async function listWorkRoles(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const rows = await ctx.db
        .select({
            id: workRoles.id,
            name: workRoles.name,
            sections: workRoles.sections,
            archivedAt: workRoles.archivedAt,
            people: sql<number>`(select count(*) from ${users} where ${users.workRoleId} = ${workRoles.id} and ${users.status} = 'active')`,
        })
        .from(workRoles)
        .where(eq(workRoles.companyId, actor.companyId))
        .orderBy(asc(workRoles.name))
        .all();
    return { workRoles: rows.map((row) => ({ ...row, sections: parseSections(row.sections) ?? [], archived: row.archivedAt !== null, people: Number(row.people) })) };
}

export async function createWorkRole(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const body = await readJson(ctx.request);
    const name = str(body, "name", { max: 60 });
    if (name.length < 2) throw badRequest("validation.invalidInput", { name: "validation.nameLength" });
    const sections = readSections(body);
    const id = newId();
    await ctx.db.insert(workRoles).values({ id, companyId: actor.companyId, name, sections: JSON.stringify(sections), createdBy: actor.userId, createdAt: ctx.now });
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "workrole.create", entityType: "work_role", entityId: id, data: { name, sections } }, ctx.now);
    return { id };
}

export async function updateWorkRole(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireRole(actor, "director");
    const role = await ctx.db.select().from(workRoles).where(and(eq(workRoles.id, ctx.params["id"] ?? ""), eq(workRoles.companyId, actor.companyId))).get();
    if (!role) throw new AppError(404, "error.notFound");
    const body = await readJson(ctx.request);
    const updates: Partial<typeof workRoles.$inferInsert> = {};
    if ("name" in body) {
        const name = str(body, "name", { max: 60 });
        if (name.length < 2) throw badRequest("validation.invalidInput", { name: "validation.nameLength" });
        updates.name = name;
    }
    if ("sections" in body) updates.sections = JSON.stringify(readSections(body));
    if ("archived" in body) updates.archivedAt = body["archived"] === true ? ctx.now : null;
    if (!Object.keys(updates).length) return { ok: true };
    await ctx.db.update(workRoles).set(updates).where(eq(workRoles.id, role.id));
    await audit(
        ctx.db,
        {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: "workrole.update",
            entityType: "work_role",
            entityId: role.id,
            data: { before: { name: role.name, sections: parseSections(role.sections), archived: role.archivedAt !== null }, after: { ...updates, sections: updates.sections ? JSON.parse(updates.sections) : undefined, archived: "archivedAt" in updates ? updates.archivedAt !== null : undefined } },
        },
        ctx.now
    );
    return { ok: true };
}

/** Действующая рабочая роль компании (для назначения человеку) */
export async function loadActiveWorkRole(ctx: Ctx, companyId: string, id: string) {
    const role = await ctx.db.select().from(workRoles).where(and(eq(workRoles.id, id), eq(workRoles.companyId, companyId), isNull(workRoles.archivedAt))).get();
    if (!role) throw badRequest("validation.invalidInput", { workRoleId: "workRoles.notFound" });
    return role;
}
