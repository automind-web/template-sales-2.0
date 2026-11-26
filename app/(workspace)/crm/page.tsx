"use client";

import { Download, Kanban, List, Plus, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { CreateLeadDialog } from "../../../components/crm/create-dialog.tsx";
import { LeadKanban } from "../../../components/crm/kanban-view.tsx";
import { LeadList } from "../../../components/crm/list-view.tsx";
import { allowedTargets, missingFor, patchLead, stageLabel, type CrmConfig, type Lead } from "../../../components/crm/model.ts";
import { StageDialog } from "../../../components/crm/stage-dialog.tsx";
import { useSession } from "../../../components/session.tsx";
import { Chip, Kbd } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Card, EmptyState, Spinner } from "../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../components/ui/error-retry.tsx";
import { Select } from "../../../components/ui/input.tsx";
import { useToast } from "../../../components/ui/toast.tsx";
import { t } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { hotkeyKeys, isTypingTarget, matchHotkey, topDialog, useHotkeyHints } from "../../../lib/hotkeys.ts";
import { useApiData } from "../../../lib/use-api.ts";
import { cn } from "../../../lib/utils.ts";

type ListResponse = { leads: Lead[]; counts: Record<string, number>; total: number };

const SCROLL_KEY = "crm-scroll";
const FILTER_KEYS = ["q", "stage", "owner", "due", "mine"] as const;

export default function CrmPage() {
    return (
        <SectionGate section="crm" title={t("crm.title")}>
            <Crm />
        </SectionGate>
    );
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    const copy = { ...record };
    delete copy[key];
    return copy;
}

function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function Crm() {
    const { me } = useSession();
    const branchId = me.user.role === "director" ? me.selectedBranchId : me.user.branchId;
    if (!branchId || branchId === "*") {
        return (
            <Page title={t("crm.title")}>
                <Card>
                    <EmptyState icon={Kanban} title={t("crm.selectBranch")}>
                        {t("shell.selectBranchForCrm")}
                    </EmptyState>
                </Card>
            </Page>
        );
    }
    return <CrmBoard key={branchId} branchId={branchId} />;
}

function CrmBoard({ branchId }: { branchId: string }) {
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname() ?? "/crm";
    const now = useNow();
    const toast = useToast();
    const searchRef = useRef<HTMLInputElement>(null);
    const [creating, setCreating] = useState(false);
    const [stageDialog, setStageDialog] = useState<{ lead: Lead; target: string } | null>(null);
    const [pending, setPending] = useState<Record<string, string>>({});
    // Результаты переносов до перезагрузки списка; привязаны к версии данных, с которой сделаны.
    const [overrides, setOverrides] = useState<{ base: unknown; leads: Record<string, Lead> }>({ base: null, leads: {} });

    const view = params?.get("view") === "kanban" ? "kanban" : "list";
    const filters = new URLSearchParams();
    for (const key of FILTER_KEYS) {
        const value = params?.get(key);
        if (value) filters.set(key, value);
    }
    const filterQuery = filters.toString();
    const [search, setSearch] = useState(params?.get("q") ?? "");

    // Последний запрошенный адрес: router.replace применяется не мгновенно, а быстрые клики не должны терять изменения.
    const queryRef = useRef(params?.toString() ?? "");
    useEffect(() => {
        queryRef.current = params?.toString() ?? "";
    }, [params]);

    function setParams(patch: Record<string, string | null>) {
        const next = new URLSearchParams(queryRef.current);
        for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        const query = next.toString();
        queryRef.current = query;
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }

    // Поиск применяется после короткой паузы ввода.
    useEffect(() => {
        const timer = setTimeout(() => {
            if ((params?.get("q") ?? "") !== search.trim()) setParams({ q: search.trim() || null });
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    const config = useApiData(`crm-config-${branchId}`, (signal) => api<CrmConfig>(`/api/crm/config?branchId=${encodeURIComponent(branchId)}`, { signal }));
    const list = useApiData(`crm-leads-${branchId}-${filterQuery}`, (signal) => api<ListResponse>(`/api/crm/leads?branchId=${encodeURIComponent(branchId)}&${filterQuery}`, { signal }));

    // «/» — к поиску (вне поля ввода и не сквозь диалог).
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (!matchHotkey("focusSearch", event) || isTypingTarget(event.target) || topDialog()) return;
            event.preventDefault();
            searchRef.current?.focus();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    // Возврат из карточки: восстанавливаем прокрутку того же среза.
    useEffect(() => {
        if (!list.data) return;
        try {
            const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "null") as { key: string; y: number } | null;
            if (saved && saved.key === `${view}?${filterQuery}`) {
                sessionStorage.removeItem(SCROLL_KEY);
                requestAnimationFrame(() => window.scrollTo(0, saved.y));
            }
        } catch {
            // Хранилище браузера может быть недоступно — это не мешает работе.
        }
    }, [list.data, view, filterQuery]);

    function open(lead: Lead) {
        try {
            sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ key: `${view}?${filterQuery}`, y: window.scrollY }));
        } catch {
            // без восстановления прокрутки
        }
        router.push(`/crm/${lead.id}`);
    }

    const cfg = config.data;
    const localLeads = overrides.base === list.data ? overrides.leads : {};
    const leads = (list.data?.leads ?? []).map((lead) => localLeads[lead.id] ?? lead);
    const override = (lead: Lead) => setOverrides({ base: list.data, leads: { ...localLeads, [lead.id]: lead } });

    async function move(lead: Lead, target: string) {
        if (!cfg) return;
        const funnel = cfg.funnel;
        if (!allowedTargets(funnel, lead.stage).some((stage) => stage.key === target)) return forbidden(lead, target);
        const missing = missingFor(funnel, target, lead);
        const needsComment = funnel.stages.find((stage) => stage.key === target)?.requiredFields?.includes("comment");
        if (missing.length || needsComment) {
            setStageDialog({ lead, target });
            return;
        }
        setPending((current) => ({ ...current, [lead.id]: target }));
        const result = await patchLead(lead, { stage: target });
        if (result.ok) {
            override(result.detail.lead);
            setPending((current) => withoutKey(current, lead.id));
            toast.show({ kind: "success", text: t("crm.moved", { number: lead.number, stage: stageLabel(funnel, target) }) });
            list.reload();
            return;
        }
        // Отказ сервера: карточка возвращается на место, причина — в сообщении.
        setPending((current) => withoutKey(current, lead.id));
        toast.show({ kind: "error", text: t("crm.moveFailed", { number: lead.number, reason: result.error.message }) });
        if (result.error.status === 409) list.reload();
    }

    function forbidden(lead: Lead, target: string) {
        if (!cfg) return;
        toast.show({ kind: "error", text: t("crm.dropForbidden", { from: stageLabel(cfg.funnel, lead.stage), to: stageLabel(cfg.funnel, target) }) });
    }

    const filtersActive = FILTER_KEYS.some((key) => key !== "mine" && params?.get(key));
    const selectedStages = (params?.get("stage") ?? "").split(",").filter(Boolean);
    const showKeys = useHotkeyHints();

    return (
        <Page title={t("crm.title")}>
            <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <label className="relative flex min-w-56 flex-1 items-center">
                        <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
                        <input
                            ref={searchRef}
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t("crm.searchPlaceholder")}
                            aria-label={t("crm.searchPlaceholder")}
                            aria-keyshortcuts="/"
                            className="control-h w-full rounded-lg border border-input bg-surface pr-10 pl-9 text-sm font-medium placeholder:font-normal placeholder:text-muted-foreground"
                        />
                        {showKeys ? <Kbd className="pointer-events-none absolute right-3 text-muted-foreground">{hotkeyKeys("focusSearch")}</Kbd> : null}
                    </label>
                    <div role="group" aria-label={t("crm.view")} className="flex overflow-hidden rounded-lg border border-border bg-surface">
                        {(["list", "kanban"] as const).map((key) => (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={view === key}
                                aria-label={key === "list" ? t("crm.viewList") : t("crm.viewKanban")}
                                title={key === "list" ? t("crm.viewList") : t("crm.viewKanban")}
                                onClick={() => setParams({ view: key === "list" ? null : "kanban" })}
                                className={cn("control-h inline-flex w-11 cursor-pointer items-center justify-center", view === key ? "bg-selected text-selected-foreground" : "text-foreground/70 hover:bg-muted")}
                            >
                                {key === "list" ? <List className="size-[18px]" /> : <Kanban className="size-[18px]" />}
                            </button>
                        ))}
                    </div>
                    {cfg && !cfg.ownOnly ? (
                        <div role="group" aria-label={t("crm.scope")} className="flex overflow-hidden rounded-lg border border-border bg-surface">
                            {[
                                { key: "1", label: t("crm.mine") },
                                { key: null, label: t("crm.all") },
                            ].map((item) => (
                                <button
                                    key={item.label}
                                    type="button"
                                    aria-pressed={(params?.get("mine") ?? null) === item.key}
                                    onClick={() => setParams({ mine: item.key })}
                                    className={cn("control-h cursor-pointer px-4 text-sm font-semibold whitespace-nowrap", (params?.get("mine") ?? null) === item.key ? "bg-selected text-selected-foreground" : "text-foreground/75 hover:bg-muted")}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <Button onClick={() => setCreating(true)} disabled={!cfg}>
                        <Plus className="size-4" />
                        {t("crm.newLead")}
                    </Button>
                </div>

                {cfg ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {cfg.funnel.stages.map((stage) => (
                            <Chip
                                key={stage.key}
                                selected={selectedStages.includes(stage.key)}
                                count={list.data?.counts[stage.key] ?? 0}
                                onClick={() => {
                                    const next = selectedStages.includes(stage.key) ? selectedStages.filter((key) => key !== stage.key) : [...selectedStages, stage.key];
                                    setParams({ stage: next.join(",") || null });
                                }}
                            >
                                {stage.label}
                            </Chip>
                        ))}
                        <Select aria-label={t("crm.colNextContact")} className="w-auto min-w-44" value={params?.get("due") ?? ""} onChange={(event) => setParams({ due: event.target.value || null })}>
                            <option value="">{t("crm.dueAny")}</option>
                            <option value="overdue">{t("crm.dueOverdue")}</option>
                            <option value="today">{t("crm.dueToday")}</option>
                            <option value="week">{t("crm.dueWeek")}</option>
                            <option value="none">{t("crm.dueNone")}</option>
                        </Select>
                        {cfg.canAssign ? (
                            <Select aria-label={t("crm.colOwner")} className="w-auto min-w-48" value={params?.get("owner") ?? ""} onChange={(event) => setParams({ owner: event.target.value || null })}>
                                <option value="">{t("crm.ownerAll")}</option>
                                <option value="none">{t("crm.ownerNone")}</option>
                                {cfg.owners.map((owner) => (
                                    <option key={owner.id} value={owner.id}>
                                        {owner.displayName}
                                    </option>
                                ))}
                            </Select>
                        ) : null}
                        <div className="ml-auto flex items-center gap-4 text-sm">
                            <span className="text-muted-foreground" aria-live="polite">
                                {t("crm.found", { count: list.data?.total ?? 0 })}
                            </span>
                            <a href={`/api/crm/export?branchId=${encodeURIComponent(branchId)}&${filterQuery}`} className="inline-flex items-center gap-1.5 font-bold hover:text-primary" download>
                                <Download className="size-4" />
                                {t("crm.csv")}
                            </a>
                        </div>
                    </div>
                ) : null}

                {config.error && !cfg ? (
                    <ErrorRetry message={config.error} onRetry={config.reload} />
                ) : list.error && !list.data ? (
                    <ErrorRetry message={list.error} onRetry={list.reload} />
                ) : !cfg || !list.data ? (
                    <Spinner label={t("common.loading")} />
                ) : list.data.total === 0 && !filtersActive && !params?.get("mine") ? (
                    <Card>
                        <EmptyState icon={Kanban} title={t("crm.emptyTitle")}>
                            <p>{t("crm.emptyText")}</p>
                            <Button className="mt-3" onClick={() => setCreating(true)}>
                                <Plus className="size-4" />
                                {t("crm.newLead")}
                            </Button>
                        </EmptyState>
                    </Card>
                ) : list.data.total === 0 && view === "list" ? (
                    <Card>
                        <EmptyState icon={Search} title={t("crm.noMatchTitle")}>
                            <p>{t("crm.noMatchText")}</p>
                            <Button
                                variant="secondary"
                                className="mt-3"
                                onClick={() => {
                                    setSearch("");
                                    setParams({ q: null, stage: null, owner: null, due: null, mine: null });
                                }}
                            >
                                {t("crm.resetFilters")}
                            </Button>
                        </EmptyState>
                    </Card>
                ) : view === "list" ? (
                    <LeadList leads={leads} funnel={cfg.funnel} timezone={cfg.timezone} now={now} onOpen={open} busy={list.loading} />
                ) : (
                    <LeadKanban leads={leads} funnel={cfg.funnel} timezone={cfg.timezone} now={now} pending={pending} onOpen={open} onMove={(lead, target) => void move(lead, target)} onForbidden={forbidden} />
                )}
            </div>
            {creating && cfg ? (
                <CreateLeadDialog
                    config={cfg}
                    onClose={() => setCreating(false)}
                    onCreated={(detail) => {
                        toast.show({ kind: "success", text: `#${detail.lead.number} · ${detail.lead.clientName}` });
                        list.reload();
                    }}
                />
            ) : null}
            {stageDialog && cfg ? (
                <StageDialog
                    lead={stageDialog.lead}
                    target={stageDialog.target}
                    funnel={cfg.funnel}
                    timezone={cfg.timezone}
                    currency={cfg.currency}
                    onClose={() => setStageDialog(null)}
                    onDone={(detail) => {
                        override(detail.lead);
                        toast.show({ kind: "success", text: t("crm.moved", { number: detail.lead.number, stage: stageLabel(cfg.funnel, detail.lead.stage) }) });
                        list.reload();
                    }}
                    onConflict={(_current, message) => {
                        toast.show({ kind: "error", text: message });
                        list.reload();
                    }}
                />
            ) : null}
            {toast.view}
        </Page>
    );
}
