"use client";

import { useState } from "react";
import type { FunnelConfig } from "../../config/company.ts";
import { t } from "../../i18n/index.ts";
import { inputsToUtc, localInputParts } from "../../lib/time.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Textarea } from "../ui/input.tsx";
import { patchLead, stageLabel, type Lead, type LeadDetail } from "./model.ts";

/**
 * Переход в этап с обязательными полями. Одна и та же форма открывается
 * из меню карточки, при перетаскивании на канбане и из карточки лида.
 */
export function StageDialog({
    lead,
    target,
    funnel,
    timezone,
    currency,
    onClose,
    onDone,
    onConflict,
}: {
    lead: Lead;
    target: string;
    funnel: FunnelConfig;
    timezone: string;
    currency: string;
    onClose: () => void;
    onDone: (detail: LeadDetail) => void;
    onConflict: (current: Lead | null, message: string) => void;
}) {
    const required = funnel.stages.find((stage) => stage.key === target)?.requiredFields ?? [];
    const initialContact = lead.nextContactAt !== null ? localInputParts(timezone, lead.nextContactAt) : { date: "", time: "10:00" };
    const [amount, setAmount] = useState(lead.amount === null ? "" : String(lead.amount));
    const [date, setDate] = useState(initialContact.date);
    const [time, setTime] = useState(initialContact.time);
    const [lostReason, setLostReason] = useState(lead.lostReason ?? "");
    const [comment, setComment] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    const filled =
        (!required.includes("amount") || amount.trim() !== "") &&
        (!required.includes("nextContactAt") || date !== "") &&
        (!required.includes("lostReason") || lostReason.trim() !== "") &&
        (!required.includes("comment") || comment.trim() !== "");

    async function submit() {
        setBusy(true);
        setError(null);
        setFields({});
        const changes: Record<string, unknown> = { stage: target };
        if (required.includes("amount") || amount.trim() !== String(lead.amount ?? "")) changes["amount"] = amount.trim() === "" ? null : Number(amount.replace(/\s/g, ""));
        if (required.includes("nextContactAt") || date) changes["nextContactAt"] = inputsToUtc(timezone, date, time);
        if (required.includes("lostReason") || lostReason.trim()) changes["lostReason"] = lostReason.trim() || null;
        const result = await patchLead(lead, changes, comment.trim() || undefined);
        setBusy(false);
        if (result.ok) {
            onDone(result.detail);
            onClose();
            return;
        }
        if (result.error.status === 409) {
            onConflict(result.current, result.error.message);
            onClose();
            return;
        }
        setError(result.error.message);
        setFields(result.error.fields);
    }

    return (
        <Dialog open onClose={onClose} title={t("crm.stageDialog", { stage: stageLabel(funnel, target) })} description={`#${lead.number} · ${lead.clientName}`}>
            <Form
                variant="dialog"
                onSubmit={submit}
                busy={busy}
                canSubmit={filled}
                submitLabel={t("crm.moveTo")}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
            >
                {required.length ? <p className="text-sm text-muted-foreground">{t("crm.stageDialogHint")}</p> : null}
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                {required.includes("amount") ? (
                    <Field label={t("crm.fieldAmount", { currency })} error={fields["amount"]}>
                        <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} data-autofocus />
                    </Field>
                ) : null}
                {required.includes("nextContactAt") ? (
                    <FieldGrid>
                        <Field label={t("crm.fieldNextContactDate")} error={fields["nextContactAt"]}>
                            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} data-autofocus={!required.includes("amount") || undefined} />
                        </Field>
                        <Field label={t("crm.fieldNextContactTime")}>
                            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
                        </Field>
                    </FieldGrid>
                ) : null}
                {required.includes("lostReason") ? (
                    <Field label={t("crm.fieldLostReason")} error={fields["lostReason"]}>
                        <Input value={lostReason} maxLength={300} onChange={(event) => setLostReason(event.target.value)} data-autofocus />
                    </Field>
                ) : null}
                <Field label={t("crm.fieldComment")} optional={!required.includes("comment")} error={fields["comment"]}>
                    <Textarea value={comment} maxLength={4000} rows={3} onChange={(event) => setComment(event.target.value)} />
                </Field>
            </Form>
        </Dialog>
    );
}
