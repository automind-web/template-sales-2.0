"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Page, SectionGate } from "../../../../components/app-shell.tsx";
import { missingFor, patchLead, stageLabel, stageTone, type HistoryEvent, type Lead, type LeadDetail } from "../../../../components/crm/model.ts";
import { StageDialog } from "../../../../components/crm/stage-dialog.tsx";
import { useSession } from "../../../../components/session.tsx";
import { StatusPill } from "../../../../components/ui/badge.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import { Card, Meta, Spinner } from "../../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../../components/ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../../../../components/ui/field.tsx";
import { Form } from "../../../../components/ui/form.tsx";
import { Input, Select, Textarea } from "../../../../components/ui/input.tsx";
import { useToast } from "../../../../components/ui/toast.tsx";
import { formatDateTime, formatMoney, formatShort, t, type MessageKey } from "../../../../i18n/index.ts";
import { api } from "../../../../lib/api.ts";
import { inputsToUtc, localInputParts } from "../../../../lib/time.ts";
import { useApiData } from "../../../../lib/use-api.ts";

const FIELD_LABELS: Record<string, MessageKey> = {
    amount: "required.amount",
    lostReason: "crm.fieldLostReason",
    clientName: "crm.fieldClientName",
    clientPhone: "crm.fieldClientPhone",
    clientCompany: "crm.fieldClientCompany",
};

export default function LeadPage() {
    return (
        <SectionGate section="crm" title={t("crm.title")}>
            <LeadScreen />
        </SectionGate>
    );
}

function LeadScreen() {
    const params = useParams<{ id: string }>();
    const id = typeof params?.id === "string" ? params.id : "";
    const data = useApiData(`lead-${id}`, (signal) => api<LeadDetail>(`/api/crm/leads/${encodeURIComponent(id)}`, { signal }));
    // Локальная копия после изменений; новые данные с сервера её заменяют.
    const [local, setLocal] = useState<{ base: unknown; detail: LeadDetail } | null>(null);
    // Запоздавший ответ перезагрузки (запрошен до сохранения) не перекрывает более новую версию лида.
    const detail = local && (local.base === data.data || local.detail.lead.version > (data.data?.lead.version ?? 0)) ? local.detail : data.data;

    if (!detail) {
        return (
            <Page title={t("crm.title")}>
                {data.error ? <ErrorRetry message={data.error} onRetry={data.reload} /> : <Spinner label={t("common.loading")} />}
            </Page>
        );
    }
    return <LeadCard detail={detail} onDetail={(next) => setLocal({ base: data.data, detail: next })} onReload={data.reload} />;
}

function LeadCard({ detail, onDetail, onReload }: { detail: LeadDetail; onDetail: (detail: LeadDetail) => void; onReload: () => void }) {
    const { me } = useSession();
    const router = useRouter();
    const toast = useToast();
    const { lead, funnel } = detail;
    const timezone = me.company.timezone;
    const [stageDialog, setStageDialog] = useState<string | null>(null);
    const [conflict, setConflict] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const stageIndex = funnel.stages.findIndex((stage) => stage.key === lead.stage);
    const targets = funnel.transitions[lead.stage] ?? [];
    const lostStage = funnel.stages.find((stage) => stage.terminal === "lost" && targets.includes(stage.key));
    const contact = lead.nextContactAt !== null ? localInputParts(timezone, lead.nextContactAt) : { date: "", time: "" };

    /** Применить ответ сервера: успех, отказ или конфликт версий (актуальное состояние на экран) */
    async function apply(changes: Record<string, unknown>, comment?: string): Promise<boolean> {
        setBusy(true);
        const result = await patchLead(lead, changes, comment);
        setBusy(false);
        if (result.ok) {
            setConflict(null);
            onDetail(result.detail);
            return true;
        }
        if (result.error.status === 409) {
            setConflict(t("crm.conflictText"));
            if (result.current) onDetail({ ...detail, lead: result.current });
            onReload();
        } else {
            toast.show({ kind: "error", text: result.error.message });
        }
        return false;
    }

    function changeStage(target: string) {
        if (target === lead.stage) return;
        const needsComment = funnel.stages.find((stage) => stage.key === target)?.requiredFields?.includes("comment");
        if (missingFor(funnel, target, lead).length || needsComment) setStageDialog(target);
        else void apply({ stage: target });
    }

    function back() {
        if (window.history.length > 1) router.back();
        else router.push("/crm");
    }

    const created = detail.history.find((event) => event.type === "created");

    return (
        <Page title={t("crm.title")}>
            <div className="grid gap-4">
                <button type="button" onClick={back} className="w-fit cursor-pointer text-sm font-medium text-primary hover:underline">
                    ← {t("crm.backToList")}
                </button>
                {conflict ? (
                    <FormMessage kind="error">
                        <strong>{t("crm.conflictTitle")}.</strong> {conflict}
                    </FormMessage>
                ) : null}
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="grid gap-4">
                        <ClientForm key={lead.id} lead={lead} currency={detail.currency} onSave={(changes) => apply(changes)} />
                        <Comments history={detail.history} timezone={timezone} onSend={(text) => apply({}, text)} />
                    </div>
                    <aside className="grid gap-4">
                        {lostStage ? (
                            <Button variant="danger" className="w-full" disabled={busy} onClick={() => changeStage(lostStage.key)}>
                                {lostStage.label}
                            </Button>
                        ) : null}
                        <Card className="grid gap-4 p-5">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <Meta label={t("crm.colNumber")}>#{lead.number}</Meta>
                                <StatusPill tone={stageTone(funnel.stages[stageIndex], stageIndex)}>{stageLabel(funnel, lead.stage)}</StatusPill>
                            </div>
                            <Meta label={t("common.branch")}>{lead.branchName ?? t("common.none")}</Meta>
                            <Field label={t("crm.fieldStage")}>
                                <Select value={lead.stage} disabled={busy || targets.length === 0} onChange={(event) => changeStage(event.target.value)}>
                                    <option value={lead.stage}>{stageLabel(funnel, lead.stage)}</option>
                                    {funnel.stages
                                        .filter((stage) => targets.includes(stage.key))
                                        .map((stage) => (
                                            <option key={stage.key} value={stage.key}>
                                                → {stage.label}
                                            </option>
                                        ))}
                                </Select>
                            </Field>
                            <Field label={t("crm.fieldOwner")}>
                                {detail.canAssign ? (
                                    <Select value={lead.ownerUserId ?? ""} disabled={busy} onChange={(event) => void apply({ ownerUserId: event.target.value || null })}>
                                        <option value="">{t("crm.ownerNone")}</option>
                                        {detail.owners.map((owner) => (
                                            <option key={owner.id} value={owner.id}>
                                                {owner.displayName}
                                            </option>
                                        ))}
                                    </Select>
                                ) : (
                                    <Input value={lead.ownerName ?? t("crm.ownerNone")} disabled />
                                )}
                            </Field>
                            <FieldGrid className="sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                                <Field label={t("crm.fieldNextContactDate")}>
                                    <Input
                                        type="date"
                                        key={`d-${lead.version}`}
                                        defaultValue={contact.date}
                                        disabled={busy}
                                        onChange={(event) => {
                                            if (event.target.value) void apply({ nextContactAt: inputsToUtc(timezone, event.target.value, contact.time || "10:00") });
                                        }}
                                    />
                                </Field>
                                <Field label={t("crm.fieldNextContactTime")}>
                                    <Input
                                        type="time"
                                        key={`t-${lead.version}`}
                                        defaultValue={contact.time}
                                        disabled={busy || !contact.date}
                                        onBlur={(event) => {
                                            if (contact.date && event.target.value && event.target.value !== contact.time) void apply({ nextContactAt: inputsToUtc(timezone, contact.date, event.target.value) });
                                        }}
                                    />
                                </Field>
                            </FieldGrid>
                            {lead.nextContactAt !== null ? (
                                <Button variant="link" className="w-fit" disabled={busy} onClick={() => void apply({ nextContactAt: null })}>
                                    {t("crm.clearContact")}
                                </Button>
                            ) : null}
                            <div className="grid grid-cols-2 gap-4">
                                <Meta label={t("crm.createdBy")}>{created?.actorName ?? t("common.none")}</Meta>
                                <Meta label={t("crm.createdAt")}>{formatShort(lead.createdAt, timezone)}</Meta>
                            </div>
                            <Meta label={t("crm.source")}>{t(`crm.source.${lead.source}` as MessageKey)}</Meta>
                        </Card>
                        <History history={detail.history} funnel={funnel} timezone={timezone} />
                    </aside>
                </div>
            </div>
            {stageDialog ? (
                <StageDialog
                    lead={lead}
                    target={stageDialog}
                    funnel={funnel}
                    timezone={timezone}
                    currency={detail.currency}
                    onClose={() => setStageDialog(null)}
                    onDone={(next) => {
                        setConflict(null);
                        onDetail(next);
                    }}
                    onConflict={(current) => {
                        setConflict(t("crm.conflictText"));
                        if (current) onDetail({ ...detail, lead: current });
                        onReload();
                    }}
                />
            ) : null}
            {toast.view}
        </Page>
    );
}

/** Данные клиента. Введённые значения не сбрасываются при конфликте версий. */
function ClientForm({ lead, currency, onSave }: { lead: Lead; currency: string; onSave: (changes: Record<string, unknown>) => Promise<boolean> }) {
    const [form, setForm] = useState({
        clientName: lead.clientName,
        clientPhone: lead.clientPhone ?? "",
        clientCompany: lead.clientCompany ?? "",
        amount: lead.amount === null ? "" : String(lead.amount),
        lostReason: lead.lostReason ?? "",
    });
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const update = (key: keyof typeof form, value: string) => {
        setSaved(false);
        setForm((current) => ({ ...current, [key]: value }));
    };
    const changes: Record<string, unknown> = {};
    if (form.clientName.trim() !== lead.clientName) changes["clientName"] = form.clientName;
    if (form.clientPhone.trim() !== (lead.clientPhone ?? "")) changes["clientPhone"] = form.clientPhone;
    if (form.clientCompany.trim() !== (lead.clientCompany ?? "")) changes["clientCompany"] = form.clientCompany;
    if (form.amount.trim() !== (lead.amount === null ? "" : String(lead.amount))) changes["amount"] = form.amount.trim() === "" ? null : Number(form.amount.replace(/\s/g, ""));
    if (form.lostReason.trim() !== (lead.lostReason ?? "")) changes["lostReason"] = form.lostReason;
    const dirty = Object.keys(changes).length > 0;

    return (
        <Card className="p-5">
            <h2 className="mb-4 text-[17px] font-bold">{t("crm.client")}</h2>
            <Form
                busy={busy}
                canSubmit={dirty && form.clientName.trim() !== ""}
                onSubmit={async () => {
                    setBusy(true);
                    const ok = await onSave(changes);
                    setBusy(false);
                    setSaved(ok);
                }}
            >
                {saved && !dirty ? <FormMessage kind="success">{t("crm.saved")}</FormMessage> : null}
                <Field label={t("crm.fieldClientName")}>
                    <Input value={form.clientName} maxLength={120} onChange={(event) => update("clientName", event.target.value)} />
                </Field>
                <FieldGrid>
                    <Field label={t("crm.fieldClientPhone")} optional>
                        <Input type="tel" inputMode="tel" value={form.clientPhone} maxLength={32} onChange={(event) => update("clientPhone", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldClientCompany")} optional>
                        <Input value={form.clientCompany} maxLength={120} onChange={(event) => update("clientCompany", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldAmount", { currency })} optional>
                        <Input inputMode="numeric" value={form.amount} onChange={(event) => update("amount", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldLostReason")} optional>
                        <Input value={form.lostReason} maxLength={300} onChange={(event) => update("lostReason", event.target.value)} />
                    </Field>
                </FieldGrid>
            </Form>
        </Card>
    );
}

function Comments({ history, timezone, onSend }: { history: HistoryEvent[]; timezone: string; onSend: (text: string) => Promise<boolean> }) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const comments = history.filter((event) => event.type === "comment");
    return (
        <Card className="p-5">
            <h2 className="mb-4 text-[17px] font-bold">{t("crm.comments")}</h2>
            <Form
                busy={busy}
                canSubmit={text.trim() !== ""}
                submitLabel={t("crm.send")}
                onSubmit={async () => {
                    setBusy(true);
                    // При ошибке текст остаётся в поле.
                    if (await onSend(text.trim())) setText("");
                    setBusy(false);
                }}
            >
                <Textarea aria-label={t("crm.commentPlaceholder")} placeholder={t("crm.commentPlaceholder")} value={text} maxLength={4000} rows={3} onChange={(event) => setText(event.target.value)} />
            </Form>
            {comments.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("crm.noComments")}</p>
            ) : (
                <ul className="mt-4 grid gap-3">
                    {comments.map((comment) => (
                        <li key={comment.id} className="rounded-lg bg-muted px-3.5 py-2.5">
                            <p className="text-sm whitespace-pre-line break-anywhere">{comment.newValue}</p>
                            <p className="mt-1 text-[13px] text-muted-foreground">
                                {comment.actorName ?? t("common.none")} · {formatShort(comment.createdAt, timezone)}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function History({ history, funnel, timezone }: { history: HistoryEvent[]; funnel: LeadDetail["funnel"]; timezone: string }) {
    const describe = (event: HistoryEvent): string => {
        switch (event.type) {
            case "created":
                return t("crm.event.created", { stage: stageLabel(funnel, event.newValue ?? "") });
            case "stage":
                return t("crm.event.stage", { from: stageLabel(funnel, event.oldValue ?? ""), to: stageLabel(funnel, event.newValue ?? "") });
            case "owner":
                return t("crm.event.owner", { from: event.oldLabel ?? t("crm.ownerNone"), to: event.newLabel ?? t("crm.ownerNone") });
            case "next_contact":
                return t("crm.event.next_contact", {
                    from: event.oldValue ? formatShort(Number(event.oldValue), timezone) : t("common.none"),
                    to: event.newValue ? formatShort(Number(event.newValue), timezone) : t("common.none"),
                });
            case "field": {
                const money = event.field === "amount";
                const value = (raw: string | null) => (raw === null ? t("common.none") : money ? formatMoney(Number(raw)) : raw);
                return t("crm.event.field", { field: t(FIELD_LABELS[event.field ?? ""] ?? "crm.client"), from: value(event.oldValue), to: value(event.newValue) });
            }
            case "comment":
                return `${t("crm.event.comment")}: ${(event.newValue ?? "").slice(0, 80)}${(event.newValue ?? "").length > 80 ? "…" : ""}`;
        }
    };
    return (
        <details open className="group">
            <summary className="cursor-pointer text-[15px] font-bold">{t("crm.history", { count: history.length })}</summary>
            <ul className="mt-3 grid gap-3">
                {history.map((event) => (
                    <li key={event.id}>
                        <p className="text-sm break-anywhere">{describe(event)}</p>
                        <p className="text-[13px] text-muted-foreground" title={formatDateTime(event.createdAt, timezone)}>
                            {event.actorName ?? t("common.none")} · {formatShort(event.createdAt, timezone)}
                        </p>
                    </li>
                ))}
            </ul>
        </details>
    );
}
