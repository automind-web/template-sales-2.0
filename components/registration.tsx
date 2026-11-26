"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { formatDateTime, t, type MessageKey } from "../i18n/index.ts";
import { api, ApiError, errorMessage } from "../lib/api.ts";
import { useApiData } from "../lib/use-api.ts";
import { AuthLayout, AuthLink } from "./auth-layout.tsx";
import { Spinner } from "./ui/card.tsx";
import { Field, FormMessage } from "./ui/field.tsx";
import { Form } from "./ui/form.tsx";
import { Input } from "./ui/input.tsx";

type InvitationInfo = { kind: "activation" | "invite"; role: string; companyName: string; branchName: string | null; expiresAt: number };

/**
 * Регистрация по ссылке приглашения или активации директора.
 * Открытие страницы и ошибки формы приглашение не гасят.
 */
export function RegistrationPage({ kind }: { kind: "activation" | "invite" }) {
    const params = useParams<{ token: string }>();
    const token = typeof params?.token === "string" ? params.token : "";
    const info = useApiData(`invitation-${token}`, (signal) => api<InvitationInfo>(`/api/invitations/by-token/${encodeURIComponent(token)}`, { signal }));
    const title = kind === "activation" ? t("invite.activationTitle") : t("invite.title");

    if (info.error && !info.data) {
        return (
            <AuthLayout title={title}>
                <FormMessage kind="error">{info.error}</FormMessage>
                <AuthLink href="/login">{t("auth.login.title")}</AuthLink>
            </AuthLayout>
        );
    }
    if (!info.data) {
        return (
            <AuthLayout title={title}>
                <Spinner label={t("common.loading")} />
            </AuthLayout>
        );
    }
    const data = info.data;
    const subtitle = (
        <>
            <p>{[data.companyName, data.branchName, t(`role.${data.role}` as MessageKey)].filter(Boolean).join(" · ")}</p>
            <p className="mt-0.5">{t("invite.expiresAt", { date: formatDateTime(data.expiresAt) })}</p>
        </>
    );
    return (
        <AuthLayout title={title} subtitle={subtitle}>
            <RegistrationForm token={token} />
        </AuthLayout>
    );
}

function RegistrationForm({ token }: { token: string }) {
    const [form, setForm] = useState({ displayName: "", login: "", password: "", repeat: "" });
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    function update(key: keyof typeof form, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function submit() {
        setError(null);
        const localFields: Record<string, string> = {};
        if (form.password !== form.repeat) localFields["repeat"] = t("validation.passwordMismatch");
        if (form.password.length < 10) localFields["password"] = t("validation.passwordShort");
        if (Object.keys(localFields).length) {
            setFields(localFields);
            return;
        }
        setBusy(true);
        setFields({});
        try {
            await api(`/api/invitations/by-token/${encodeURIComponent(token)}/accept`, {
                method: "POST",
                body: { displayName: form.displayName, login: form.login, password: form.password },
            });
            window.location.assign("/");
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
            setBusy(false);
        }
    }

    const filled = form.displayName.trim() !== "" && form.login.trim() !== "" && form.password !== "" && form.repeat !== "";

    return (
        <Form variant="auth" onSubmit={submit} busy={busy} canSubmit={filled} submitLabel={t("invite.submit")}>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Field label={t("invite.displayName")} error={fields["displayName"]}>
                <Input autoComplete="name" value={form.displayName} maxLength={80} onChange={(event) => update("displayName", event.target.value)} autoFocus />
            </Field>
            <Field label={t("invite.login")} hint={t("invite.loginHint")} error={fields["login"]}>
                <Input autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} value={form.login} onChange={(event) => update("login", event.target.value)} />
            </Field>
            <Field label={t("invite.password")} hint={t("invite.passwordHint")} error={fields["password"]}>
                <Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => update("password", event.target.value)} />
            </Field>
            <Field label={t("invite.passwordRepeat")} error={fields["repeat"]}>
                <Input type="password" autoComplete="new-password" value={form.repeat} onChange={(event) => update("repeat", event.target.value)} />
            </Field>
        </Form>
    );
}
