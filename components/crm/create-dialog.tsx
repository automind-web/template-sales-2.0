"use client";

import { useRef, useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { newOpId } from "../../lib/op-id.ts";
import { inputsToUtc } from "../../lib/time.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSession } from "../session.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select, Textarea } from "../ui/input.tsx";
import type { CrmConfig, LeadDetail } from "./model.ts";

export function CreateLeadDialog({ config, onClose, onCreated }: { config: CrmConfig; onClose: () => void; onCreated: (detail: LeadDetail) => void }) {
    const { me } = useSession();
    const [form, setForm] = useState({ clientName: "", clientPhone: "", clientCompany: "", ownerUserId: config.canAssign ? "" : me.user.id, date: "", time: "10:00", amount: "", comment: "" });
    // Один идентификатор на форму: повторное нажатие «Создать» не создаст второй лид.
    const opId = useRef(newOpId());
    const action = useAction();
    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

    async function submit() {
        await action.run(async () => {
            const detail = await api<LeadDetail>("/api/crm/leads", {
                method: "POST",
                body: {
                    opId: opId.current,
                    branchId: config.branch?.id,
                    clientName: form.clientName,
                    clientPhone: form.clientPhone,
                    clientCompany: form.clientCompany,
                    ownerUserId: form.ownerUserId || null,
                    nextContactAt: inputsToUtc(config.timezone, form.date, form.time),
                    amount: form.amount.trim() === "" ? null : Number(form.amount.replace(/\s/g, "")),
                    comment: form.comment,
                },
            });
            onCreated(detail);
            onClose();
        });
    }

    return (
        <Dialog open onClose={onClose} title={t("crm.newLead")} description={config.branch?.name}>
            <Form
                variant="dialog"
                onSubmit={submit}
                busy={action.busy}
                canSubmit={form.clientName.trim() !== ""}
                submitLabel={t("common.create")}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <Field label={t("crm.fieldClientName")} error={action.fields["clientName"]}>
                    <Input value={form.clientName} maxLength={120} onChange={(event) => update("clientName", event.target.value)} data-autofocus />
                </Field>
                <FieldGrid>
                    <Field label={t("crm.fieldClientPhone")} optional error={action.fields["clientPhone"]}>
                        <Input type="tel" inputMode="tel" value={form.clientPhone} maxLength={32} onChange={(event) => update("clientPhone", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldClientCompany")} optional error={action.fields["clientCompany"]}>
                        <Input value={form.clientCompany} maxLength={120} onChange={(event) => update("clientCompany", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldOwner")} error={action.fields["ownerUserId"]}>
                        <Select value={form.ownerUserId} onChange={(event) => update("ownerUserId", event.target.value)} disabled={!config.canAssign}>
                            {config.canAssign ? <option value="">{t("crm.ownerNone")}</option> : <option value={me.user.id}>{me.user.displayName}</option>}
                            {config.canAssign
                                ? config.owners.map((owner) => (
                                      <option key={owner.id} value={owner.id}>
                                          {owner.displayName}
                                          {owner.id === me.user.id ? ` (${t("team.you")})` : ""}
                                      </option>
                                  ))
                                : null}
                        </Select>
                    </Field>
                    <Field label={t("crm.fieldAmount", { currency: config.currency })} optional error={action.fields["amount"]}>
                        <Input inputMode="numeric" value={form.amount} onChange={(event) => update("amount", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldNextContactDate")} optional error={action.fields["nextContactAt"]}>
                        <Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} />
                    </Field>
                    <Field label={t("crm.fieldNextContactTime")}>
                        <Input type="time" value={form.time} onChange={(event) => update("time", event.target.value)} />
                    </Field>
                </FieldGrid>
                <Field label={t("crm.fieldComment")} optional error={action.fields["comment"]}>
                    <Textarea value={form.comment} maxLength={4000} rows={3} onChange={(event) => update("comment", event.target.value)} />
                </Field>
            </Form>
        </Dialog>
    );
}
