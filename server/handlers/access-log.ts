/**
 * Журнал действий по правам: приглашения, активация, роли и филиалы, рабочие роли,
 * отметка «Прошёл обучение», пароли. Директор видит всю компанию (или выбранный филиал),
 * руководитель — только то, что касается людей и приглашений своего филиала.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { auditLog, branches, invitations, users, workRoles } from "../../db/schema.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import { resolveBranchScope } from "../access.ts";
import { requireActor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { AppError } from "../http.ts";

export const ACCESS_ACTIONS = [
    "activation.issue",
    "owner.directorReset",
    "invitation.create",
    "invitation.reissue",
    "invitation.revoke",
    "invitation.accept",
    "user.update",
    "admission.grant",
    "admission.revoke",
    "password.resetCode",
    "password.reset",
    "password.change",
    "workrole.create",
    "workrole.update",
] as const;

type Data = Record<string, unknown> & { before?: Record<string, unknown>; after?: Record<string, unknown> };

const roleName = (role: unknown) => (typeof role === "string" && ["director", "manager", "employee"].includes(role) ? t(`role.${role}` as MessageKey) : "—");
const sectionNames = (value: unknown) =>
    Array.isArray(value) && value.length ? value.map((item) => (item === "crm" ? "CRM" : item === "kpi" ? "KPI" : item === "stats" ? t("nav.stats") : String(item))).join(", ") : t("access.noSections");

export async function accessLog(ctx: Ctx) {
    const actor = await requireActor(ctx);
    if (actor.role === "employee") throw new AppError(403, "auth.forbidden");
    const scope = await resolveBranchScope(ctx, actor, ctx.url.searchParams.get("branchId"), { allowAll: true });
    const branchFilter = scope.kind === "one" ? scope.branchId : null;
    const before = Number(ctx.url.searchParams.get("before") ?? "");
    const conditions = [eq(auditLog.companyId, actor.companyId), inArray(auditLog.action, [...ACCESS_ACTIONS])];
    if (Number.isFinite(before) && before > 0) conditions.push(lt(auditLog.createdAt, before));
    const rows = await ctx.db.select().from(auditLog).where(and(...conditions)).orderBy(desc(auditLog.createdAt)).limit(branchFilter ? 400 : 100).all();

    const parsed = rows.map((row) => {
        let data: Data = {};
        try {
            data = row.data ? (JSON.parse(row.data) as Data) : {};
        } catch {
            data = {};
        }
        return { ...row, data };
    });
    const userIds = new Set<string>();
    const invitationIds = new Set<string>();
    const workRoleIds = new Set<string>();
    const branchIds = new Set<string>();
    for (const row of parsed) {
        if (row.actorUserId) userIds.add(row.actorUserId);
        if (row.entityType === "user" && row.entityId) userIds.add(row.entityId);
        if (row.entityType === "invitation" && row.entityId) invitationIds.add(row.entityId);
        if (row.entityType === "work_role" && row.entityId) workRoleIds.add(row.entityId);
        for (const value of [row.data["branchId"], row.data.before?.["branchId"], row.data.after?.["branchId"]]) if (typeof value === "string") branchIds.add(value);
        for (const value of [row.data.before?.["workRoleId"], row.data.after?.["workRoleId"]]) if (typeof value === "string") workRoleIds.add(value);
    }
    const [people, invites, roles] = await Promise.all([
        userIds.size ? ctx.db.select({ id: users.id, name: users.displayName, branchId: users.branchId }).from(users).where(inArray(users.id, [...userIds])).all() : Promise.resolve([]),
        invitationIds.size ? ctx.db.select({ id: invitations.id, branchId: invitations.branchId, role: invitations.role }).from(invitations).where(inArray(invitations.id, [...invitationIds])).all() : Promise.resolve([]),
        workRoleIds.size ? ctx.db.select({ id: workRoles.id, name: workRoles.name }).from(workRoles).where(inArray(workRoles.id, [...workRoleIds])).all() : Promise.resolve([]),
    ]);
    for (const invite of invites) if (invite.branchId) branchIds.add(invite.branchId);
    for (const person of people) if (person.branchId) branchIds.add(person.branchId);
    const branchRows = branchIds.size ? await ctx.db.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, [...branchIds])).all() : [];
    const personById = new Map(people.map((row) => [row.id, row]));
    const inviteById = new Map(invites.map((row) => [row.id, row]));
    const roleById = new Map(roles.map((row) => [row.id, row.name]));
    const branchName = (id: unknown) => (typeof id === "string" ? (branchRows.find((row) => row.id === id)?.name ?? "—") : "—");
    const workRoleName = (id: unknown) => (typeof id === "string" ? (roleById.get(id) ?? "—") : t("access.noWorkRole"));

    // Чего касается запись: какой филиал (для руководителя и фильтра по филиалу)
    const branchOf = (row: (typeof parsed)[number]): string | null => {
        if (row.entityType === "user" && row.entityId) {
            const after = row.data.after?.["branchId"];
            const before = row.data.before?.["branchId"];
            return (typeof after === "string" ? after : null) ?? personById.get(row.entityId)?.branchId ?? (typeof before === "string" ? before : null);
        }
        if (row.entityType === "invitation" && row.entityId) return inviteById.get(row.entityId)?.branchId ?? (typeof row.data["branchId"] === "string" ? row.data["branchId"] : null);
        return null;
    };
    const relevant = (row: (typeof parsed)[number]) => {
        const onlyBranch = actor.role === "manager" ? actor.branchId : branchFilter;
        if (!onlyBranch) return true;
        const touched = [branchOf(row), row.data.before?.["branchId"], row.data.after?.["branchId"]];
        // Записи уровня компании (рабочие роли, активация) директор видит при любом филиале.
        if (actor.role === "director" && touched.every((value) => value === null || value === undefined)) return true;
        return touched.includes(onlyBranch);
    };

    const describe = (row: (typeof parsed)[number]): string => {
        const target = row.entityId ? personById.get(row.entityId)?.name ?? "—" : "—";
        const invite = row.entityId ? inviteById.get(row.entityId) : undefined;
        const inviteText = `${roleName(row.data["role"] ?? invite?.role)}${(row.data["branchId"] ?? invite?.branchId) ? `, ${branchName(row.data["branchId"] ?? invite?.branchId)}` : ""}`;
        switch (row.action) {
            case "activation.issue":
                return t("access.activationIssue");
            case "owner.directorReset":
                return t("access.ownerReset", { target });
            case "invitation.create":
                return t("access.inviteCreate", { invite: inviteText });
            case "invitation.reissue":
                return t("access.inviteReissue", { invite: inviteText });
            case "invitation.revoke":
                return t("access.inviteRevoke", { invite: inviteText });
            case "invitation.accept":
                return t("access.inviteAccept", { invite: inviteText });
            case "admission.grant":
                return t("access.admissionGrant", { target });
            case "admission.revoke":
                return t("access.admissionRevoke", { target });
            case "password.resetCode":
                return t("access.resetCode", { target });
            case "password.reset":
                return t("access.passwordReset");
            case "password.change":
                return t("access.passwordChange");
            case "workrole.create":
                return t("access.workRoleCreate", { name: String(row.data["name"] ?? "—"), sections: sectionNames(row.data["sections"]) });
            case "workrole.update": {
                const before = row.data.before ?? {};
                const after = row.data.after ?? {};
                const parts: string[] = [];
                if (after["name"] !== undefined) parts.push(t("access.renamed", { name: String(after["name"]) }));
                if (after["sections"] !== undefined) parts.push(t("access.sections", { from: sectionNames(before["sections"]), to: sectionNames(after["sections"]) }));
                if (after["archived"] === true) parts.push(t("access.archived"));
                if (after["archived"] === false) parts.push(t("access.restored"));
                return t("access.workRoleUpdate", { name: String(before["name"] ?? "—"), changes: parts.join("; ") || "—" });
            }
            case "user.update": {
                const before = row.data.before ?? {};
                const after = row.data.after ?? {};
                const parts: string[] = [];
                if (after["role"] !== undefined && after["role"] !== before["role"]) parts.push(t("access.roleChange", { from: roleName(before["role"]), to: roleName(after["role"]) }));
                if (after["branchId"] !== undefined && after["branchId"] !== before["branchId"]) parts.push(t("access.branchChange", { from: branchName(before["branchId"]), to: branchName(after["branchId"]) }));
                if (after["status"] !== undefined && after["status"] !== before["status"]) parts.push(after["status"] === "disabled" ? t("access.disabled") : t("access.enabled"));
                if (after["workRoleId"] !== undefined && after["workRoleId"] !== before["workRoleId"]) parts.push(t("access.workRoleChange", { from: workRoleName(before["workRoleId"]), to: workRoleName(after["workRoleId"]) }));
                return t("access.userUpdate", { target, changes: parts.join("; ") || "—" });
            }
            default:
                return row.action;
        }
    };

    const entries = parsed.filter(relevant).slice(0, 100).map((row) => ({
        id: row.id,
        at: row.createdAt,
        action: row.action,
        actorName: row.actorUserId ? (personById.get(row.actorUserId)?.name ?? null) : row.action === "owner.directorReset" || row.action === "activation.issue" ? t("access.owner") : null,
        text: describe(row),
    }));
    return { entries, nextBefore: rows.length ? rows[rows.length - 1]!.createdAt : null };
}
