"use client";

import { useState } from "react";
import { AuthLayout } from "../../components/auth-layout.tsx";
import { Field, FormMessage } from "../../components/ui/field.tsx";
import { Form } from "../../components/ui/form.tsx";
import { Input } from "../../components/ui/input.tsx";
import { t } from "../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../lib/api.ts";

export default function ResetPage() {
    const [form, setForm] = useState({ login: "", code: "", password: "", repeat: "" });
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    async function submit() {
        setError(null);
        if (form.password !== form.repeat) {
            setFields({ repeat: t("validation.passwordMismatch") });
            return;
        }
        setBusy(true);
        setFields({});
        try {
            await api("/api/auth/reset", { method: "POST", body: { login: form.login, code: form.code, password: form.password } });
            setDone(true);
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
        } finally {
            setBusy(false);
        }
    }

    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

    return (
        <AuthLayout title={t("reset.title")} subtitle={t("reset.subtitle")}>
            {done ? (
                <div className="grid gap-3">
                    <FormMessage kind="success">{t("reset.done")}</FormMessage>
                    <a className="text-sm text-primary hover:underline" href="/login">
                        {t("auth.login.title")}
                    </a>
                </div>
            ) : (
                <Form onSubmit={submit} busy={busy} canSubmit={Object.values(form).every((value) => value.trim() !== "")} submitLabel={t("reset.submit")}>
                    {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                    <Field label={t("common.login")} error={fields["login"]}>
                        <Input autoComplete="username" autoCapitalize="none" value={form.login} onChange={(event) => update("login", event.target.value)} autoFocus />
                    </Field>
                    <Field label={t("reset.code")} error={fields["code"]}>
                        <Input autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={form.code} onChange={(event) => update("code", event.target.value)} />
                    </Field>
                    <Field label={t("reset.newPassword")} hint={t("invite.passwordHint")} error={fields["password"]}>
                        <Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => update("password", event.target.value)} />
                    </Field>
                    <Field label={t("invite.passwordRepeat")} error={fields["repeat"]}>
                        <Input type="password" autoComplete="new-password" value={form.repeat} onChange={(event) => update("repeat", event.target.value)} />
                    </Field>
                </Form>
            )}
        </AuthLayout>
    );
}
