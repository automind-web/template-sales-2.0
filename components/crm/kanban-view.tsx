"use client";

import { useRef, useState } from "react";
import type { FunnelConfig } from "../../config/company.ts";
import { formatMoney, t } from "../../i18n/index.ts";
import { cn } from "../../lib/utils.ts";
import { Menu } from "../ui/menu.tsx";
import { allowedTargets, dueLabel, type Lead } from "./model.ts";

/**
 * Канбан: те же лиды, что и в списке (один запрос). Перетаскивание мышью:
 * допустимые колонки подсвечены, остальные приглушены. На телефоне и с клавиатуры —
 * меню «…» карточки → «Перенести в этап».
 * pending — лиды, ожидающие ответа сервера после переноса (показаны в новой колонке).
 */
export function LeadKanban({
    leads,
    funnel,
    timezone,
    now,
    pending,
    onOpen,
    onMove,
    onForbidden,
}: {
    leads: Lead[];
    funnel: FunnelConfig;
    timezone: string;
    now: number;
    pending: Record<string, string>;
    onOpen: (lead: Lead) => void;
    onMove: (lead: Lead, target: string) => void;
    onForbidden: (lead: Lead, target: string) => void;
}) {
    const [dragging, setDragging] = useState<Lead | null>(null);
    const [over, setOver] = useState<string | null>(null);
    // Колонка под курсором в конце перетаскивания: в запрещённую браузер не присылает drop.
    const overRef = useRef<string | null>(null);
    const allowed = dragging ? new Set(allowedTargets(funnel, dragging.stage).map((stage) => stage.key)) : null;

    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            <div className="flex min-w-max snap-x gap-4">
                {funnel.stages.map((stage) => {
                    const items = leads.filter((lead) => (pending[lead.id] ?? lead.stage) === stage.key);
                    const isAllowed = allowed?.has(stage.key) ?? false;
                    const isSource = dragging?.stage === stage.key;
                    return (
                        <section
                            key={stage.key}
                            aria-label={stage.label}
                            onDragOver={(event) => {
                                if (!dragging || isSource) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = isAllowed ? "move" : "none";
                                overRef.current = stage.key;
                                setOver(stage.key);
                            }}
                            onDragLeave={(event) => {
                                // Переход внутри колонки или отпускание кнопки (relatedTarget = null) колонку не меняют.
                                const next = event.relatedTarget as Node | null;
                                if (!next || event.currentTarget.contains(next)) return;
                                if (overRef.current === stage.key) overRef.current = null;
                                setOver((current) => (current === stage.key ? null : current));
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const lead = dragging;
                                overRef.current = null;
                                setDragging(null);
                                setOver(null);
                                if (!lead || lead.stage === stage.key) return;
                                if (isAllowed) onMove(lead, stage.key);
                                else onForbidden(lead, stage.key);
                            }}
                            className={cn(
                                "flex w-[300px] shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/70 p-2.5 transition-[background-color,opacity,box-shadow]",
                                dragging && !isSource && isAllowed && "bg-selected/70 ring-2 ring-primary/60",
                                dragging && !isSource && !isAllowed && "opacity-45",
                                over === stage.key && isAllowed && "ring-primary"
                            )}
                        >
                            <h2 className="flex items-center gap-2 px-1.5 pt-1 pb-2.5 text-[15px] font-bold">
                                {stage.label}
                                <span className="font-semibold text-muted-foreground">{items.length}</span>
                                {dragging && !isSource && isAllowed ? <span className="ml-auto text-xs font-semibold text-primary">{t("crm.dropHere")}</span> : null}
                            </h2>
                            <ul className="grid gap-2.5">
                                {items.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">{t("crm.noStageLeads")}</li> : null}
                                {items.map((lead) => (
                                    <KanbanCard
                                        key={`${lead.id}-${pending[lead.id] ?? lead.stage}`}
                                        lead={lead}
                                        funnel={funnel}
                                        timezone={timezone}
                                        now={now}
                                        isPending={lead.id in pending}
                                        onOpen={onOpen}
                                        onMove={onMove}
                                        onDragStart={() => setDragging(lead)}
                                        onDragEnd={() => {
                                            const target = overRef.current;
                                            overRef.current = null;
                                            setDragging(null);
                                            setOver(null);
                                            if (target && target !== lead.stage && !allowedTargets(funnel, lead.stage).some((item) => item.key === target)) onForbidden(lead, target);
                                        }}
                                    />
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

function KanbanCard({
    lead,
    funnel,
    timezone,
    now,
    isPending,
    onOpen,
    onMove,
    onDragStart,
    onDragEnd,
}: {
    lead: Lead;
    funnel: FunnelConfig;
    timezone: string;
    now: number;
    isPending: boolean;
    onOpen: (lead: Lead) => void;
    onMove: (lead: Lead, target: string) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
}) {
    const due = dueLabel(lead, timezone, now);
    const targets = allowedTargets(funnel, lead.stage);
    return (
        <li
            draggable={!isPending}
            onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", lead.id);
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            tabIndex={0}
            data-lead={lead.id}
            aria-busy={isPending}
            onClick={() => onOpen(lead)}
            onKeyDown={(event) => {
                if (event.key === "Enter" && event.target === event.currentTarget) {
                    event.preventDefault();
                    onOpen(lead);
                }
            }}
            className={cn(
                "card-in cursor-pointer rounded-xl border border-border bg-surface p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-shadow hover:shadow-md active:cursor-grabbing",
                isPending && "pointer-events-none opacity-60"
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold break-anywhere">{lead.clientName}</h3>
                <Menu
                    label={t("crm.cardMenu", { number: lead.number })}
                    header={targets.length ? t("crm.moveTo") : undefined}
                    items={[
                        ...targets.map((stage) => ({ label: `→ ${stage.label}`, onSelect: () => onMove(lead, stage.key), tone: stage.terminal === "lost" ? ("danger" as const) : undefined })),
                        { label: t("crm.open"), onSelect: () => onOpen(lead) },
                    ]}
                    className="-mt-1 -mr-1.5"
                />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="truncate">{lead.ownerName ?? t("crm.ownerNone")}</span>
                <span>#{lead.number}</span>
            </div>
            {lead.amount !== null ? <div className="mt-1 text-sm font-semibold">{formatMoney(lead.amount)}</div> : null}
            <div className={cn("mt-1.5 text-sm", due.tone === "danger" ? "font-bold text-danger" : due.tone === "warning" ? "font-semibold text-warning" : "text-muted-foreground")}>{due.text}</div>
        </li>
    );
}
