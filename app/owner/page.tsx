"use client";

import { useState } from "react";
import { AuthLayout } from "../../components/auth-layout.tsx";
import { CopyLink } from "../../components/copy-link.tsx";
import { Field, FormMessage } from "../../components/ui/field.tsx";
import { Form } from "../../components/ui/form.tsx";
import { Input } from "../../components/ui/input.tsx";
import { companyConfig } from "../../config/company.ts";
import { formatDateTime, t } from "../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../lib/api.ts";

/** Первый запуск: владелец сайта выпускает одноразовое приглашение первого директора */
export default function OwnerPage() {
    const [form, setForm] = useState({ code: "", companyName: companyConfig.name, ttlHours: String(companyConfig.activationLinkTtlHours) });
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ url: string; expiresAt: number } | null>(null);

    async function submit() {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            const issued = await api<{ path: string; expiresAt: number }>("/api/owner/activation-links", {
                method: "POST",
                body: { code: form.code, companyName: form.companyName, ttlHours: Number(form.ttlHours) },
            });
            setResult({ url: `${window.location.origin}${issued.path}`, expiresAt: issued.expiresAt });
            setForm((current) => ({ ...current, code: "" }));
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
        } finally {
            setBusy(false);
        }
    }

    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

    return (
        <AuthLayout title={t("owner.title")} subtitle={t("owner.subtitle")}>
            {result ? (
                <div className="mb-5 grid gap-2">
                    <FormMessage kind="success">{t("owner.result", { date: formatDateTime(result.expiresAt) })}</FormMessage>
                    <CopyLink url={result.url} />
                </div>
            ) : null}
            <Form variant="auth" onSubmit={submit} busy={busy} canSubmit={form.code.trim() !== "" && form.ttlHours !== ""} submitLabel={t("owner.submit")}>
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                <Field label={t("owner.code")} error={fields["code"]}>
                    <Input type="password" autoComplete="off" value={form.code} onChange={(event) => update("code", event.target.value)} autoFocus />
                </Field>
                <Field label={t("owner.companyName")} hint={t("owner.companyNameHint")} error={fields["companyName"]}>
                    <Input value={form.companyName} maxLength={120} onChange={(event) => update("companyName", event.target.value)} />
                </Field>
                <Field label={t("owner.ttl")} error={fields["ttlHours"]}>
                    <Input type="number" inputMode="numeric" min={1} max={168} value={form.ttlHours} onChange={(event) => update("ttlHours", event.target.value)} />
                </Field>
            </Form>
        </AuthLayout>
    );
}
