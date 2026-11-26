"use client";

import type { FunnelConfig, FunnelStage } from "../../config/company.ts";
import { formatShort, t } from "../../i18n/index.ts";
import { api, ApiError } from "../../lib/api.ts";
import { newOpId } from "../../lib/op-id.ts";
import { localDateOf } from "../../lib/time.ts";
import type { Tone } from "../ui/badge.tsx";

export type Lead = {
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

export type Owner = { id: string; displayName: string; role: string };

export type CrmConfig = {
    branch: { id: string; name: string } | null;
    funnel: FunnelConfig;
    owners: Owner[];
    canAssign: boolean;
    ownOnly: boolean;
    currency: string;
    timezone: string;
};

export type HistoryEvent = {
    id: string;
    type: "created" | "stage" | "owner" | "next_contact" | "field" | "comment";
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    oldLabel: string | null;
    newLabel: string | null;
    actorName: string | null;
    createdAt: number;
};

export type LeadDetail = { lead: Lead; history: HistoryEvent[]; funnel: FunnelConfig; owners: Owner[]; canAssign: boolean; currency: string; repeated?: boolean };

export type RequiredField = "amount" | "comment" | "nextContactAt" | "lostReason";

export function stageLabel(funnel: FunnelConfig, key: string): string {
    return funnel.stages.find((stage) => stage.key === key)?.label ?? key;
}

/** Цвет метки этапа (подпись всегда текстом): конечные — зелёный/красный, остальные по порядку */
export function stageTone(stage: FunnelStage | undefined, index: number): Tone {
    if (stage?.terminal === "won") return "success";
    if (stage?.terminal === "lost") return "danger";
    return index === 0 ? "neutral" : index >= 3 ? "warning" : "info";
}

export function allowedTargets(funnel: FunnelConfig, from: string): FunnelStage[] {
    const keys = funnel.transitions[from] ?? [];
    return funnel.stages.filter((stage) => keys.includes(stage.key));
}

export function missingFor(funnel: FunnelConfig, target: string, lead: Pick<Lead, "amount" | "nextContactAt" | "lostReason">): RequiredField[] {
    const stage = funnel.stages.find((item) => item.key === target);
    return (stage?.requiredFields ?? []).filter((field) => {
        if (field === "amount") return lead.amount === null;
        if (field === "nextContactAt") return lead.nextContactAt === null;
        if (field === "lostReason") return !lead.lostReason;
        return true; // комментарий вводится при переходе
    });
}

/** Подпись срока контакта: просрочено / сегодня / дата — словами, а не только цветом */
export function dueLabel(lead: Pick<Lead, "nextContactAt" | "overdue" | "closedAt">, timezone: string, now: number): { text: string; tone: "danger" | "warning" | "muted" } {
    if (lead.nextContactAt === null) return { text: t("crm.noContact"), tone: "muted" };
    const date = formatShort(lead.nextContactAt, timezone);
    if (lead.overdue) return { text: t("crm.overdue", { date }), tone: "danger" };
    const today = localDateOf(timezone, now);
    const day = localDateOf(timezone, lead.nextContactAt);
    if (today.year === day.year && today.month === day.month && today.day === day.day) {
        return { text: t("crm.today", { time: date.split(", ")[1] ?? date }), tone: "warning" };
    }
    return { text: t("crm.contactAt", { date }), tone: "muted" };
}

export type PatchResult = { ok: true; detail: LeadDetail } | { ok: false; error: ApiError; current: Lead | null };

/** Изменение лида: номер версии + новый идентификатор операции на каждое действие */
export async function patchLead(lead: Pick<Lead, "id" | "version">, changes: Record<string, unknown>, comment?: string, opId: string = newOpId()): Promise<PatchResult> {
    try {
        const detail = await api<LeadDetail>(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: { opId, version: lead.version, changes, ...(comment ? { comment } : {}) } });
        return { ok: true, detail };
    } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;
        return { ok: false, error: caught, current: (caught.extra["lead"] as Lead | undefined) ?? null };
    }
}
