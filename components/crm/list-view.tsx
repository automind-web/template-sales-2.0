"use client";

import { useRef } from "react";
import type { FunnelConfig } from "../../config/company.ts";
import { formatMoney, t } from "../../i18n/index.ts";
import { isComposing } from "../../lib/hotkeys.ts";
import { cn } from "../../lib/utils.ts";
import { StatusPill } from "../ui/badge.tsx";
import { Table, Td, Th, THead } from "../ui/table.tsx";
import { dueLabel, stageLabel, stageTone, type Lead } from "./model.ts";

/**
 * Список лидов. Сразу видно, с кем и когда связаться: клиент и следующий
 * контакт в строке, просроченные подписаны «Просрочено».
 * Клавиатура: Tab/стрелки — по строкам, Enter — открыть карточку.
 */
export function LeadList({ leads, funnel, timezone, now, onOpen, busy }: { leads: Lead[]; funnel: FunnelConfig; timezone: string; now: number; onOpen: (lead: Lead) => void; busy: boolean }) {
    const bodyRef = useRef<HTMLTableSectionElement>(null);

    function onKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, lead: Lead) {
        if (isComposing(event.nativeEvent)) return;
        if (event.key === "Enter") {
            event.preventDefault();
            onOpen(lead);
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-lead]") ?? []);
            const index = rows.indexOf(event.currentTarget);
            rows[event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)]?.focus();
        }
    }

    return (
        <Table aria-busy={busy} className={busy ? "opacity-70" : undefined}>
            <THead>
                <tr>
                    <Th className="w-16">{t("crm.colNumber")}</Th>
                    <Th>{t("crm.colClient")}</Th>
                    <Th>{t("crm.colOwner")}</Th>
                    <Th>{t("crm.colNextContact")}</Th>
                    <Th className="text-right">{t("crm.colAmount")}</Th>
                    <Th>{t("crm.colStage")}</Th>
                </tr>
            </THead>
            <tbody ref={bodyRef}>
                {leads.map((lead) => {
                    const due = dueLabel(lead, timezone, now);
                    const index = funnel.stages.findIndex((stage) => stage.key === lead.stage);
                    return (
                        <tr
                            key={lead.id}
                            data-lead={lead.id}
                            tabIndex={0}
                            onClick={() => onOpen(lead)}
                            onKeyDown={(event) => onKeyDown(event, lead)}
                            aria-label={`#${lead.number} ${lead.clientName}`}
                            className="cursor-pointer border-t border-border hover:bg-muted/60 focus-visible:bg-selected/60"
                        >
                            <Td className="text-muted-foreground">#{lead.number}</Td>
                            <Td className="min-w-52">
                                <div className="font-bold break-anywhere">{lead.clientName}</div>
                                {lead.clientPhone || lead.clientCompany ? <div className="text-[13px] text-muted-foreground break-anywhere">{[lead.clientPhone, lead.clientCompany].filter(Boolean).join(" · ")}</div> : null}
                            </Td>
                            <Td className="min-w-40 break-anywhere">{lead.ownerName ?? <span className="text-muted-foreground">{t("crm.ownerNone")}</span>}</Td>
                            <Td className={cn("whitespace-nowrap", due.tone === "danger" && "font-bold text-danger", due.tone === "warning" && "font-semibold text-warning", due.tone === "muted" && "text-muted-foreground")}>{due.text}</Td>
                            <Td className="text-right whitespace-nowrap">{lead.amount === null ? <span className="text-muted-foreground">{t("common.none")}</span> : formatMoney(lead.amount)}</Td>
                            <Td>
                                <StatusPill tone={stageTone(funnel.stages[index], index)}>{stageLabel(funnel, lead.stage)}</StatusPill>
                            </Td>
                        </tr>
                    );
                })}
            </tbody>
        </Table>
    );
}
