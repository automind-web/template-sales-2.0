"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthLayout } from "../../components/auth-layout.tsx";
import { Field, FormMessage } from "../../components/ui/field.tsx";
import { Form } from "../../components/ui/form.tsx";
import { Input } from "../../components/ui/input.tsx";
import { t } from "../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../lib/api.ts";

export default function LoginPage() {
    const [login, setLogin] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    async function submit() {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            await api("/api/auth/login", { method: "POST", body: { login, password } });
            const next = new URLSearchParams(window.location.search).get("next");
            window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
            setBusy(false);
        }
    }

    return (
        <AuthLayout title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
            <Form onSubmit={submit} busy={busy} canSubmit={login.trim() !== "" && password !== ""} submitLabel={t("auth.login.submit")}>
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                <Field label={t("common.login")} error={fields["login"]}>
                    <Input autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(event) => setLogin(event.target.value)} data-autofocus autoFocus />
                </Field>
                <Field label={t("common.password")} error={fields["password"]}>
                    <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
            </Form>
            <p className="mt-4 text-sm">
                <Link className="text-primary underline-offset-4 hover:underline" href="/reset">
                    {t("auth.login.forgot")}
                </Link>
            </p>
        </AuthLayout>
    );
}
