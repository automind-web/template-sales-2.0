"use client";

import { useState } from "react";
import { PageHeader } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "../../../components/ui/card.tsx";
import { Field, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { formatDateTime, t, type MessageKey } from "../../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../../lib/api.ts";
import { useApiData } from "../../../lib/use-api.ts";

type SessionRow = { id: string; current: boolean; createdAt: number; lastSeenAt: number; userAgent: string | null };

export default function ProfilePage() {
    const { me } = useSession();
    return (
        <>
            <PageHeader title={t("profile.title")} />
            <div className="grid max-w-3xl gap-3">
                <Card>
                    <CardContent className="grid gap-1 text-sm">
                        <div className="text-base font-semibold break-anywhere">{me.user.displayName}</div>
                        <div className="text-muted-foreground break-anywhere">
                            {t("common.login")}: {me.user.login} · {t(`role.${me.user.role}` as MessageKey)}
                            {me.user.branchName ? ` · ${me.user.branchName}` : ""}
                        </div>
                        {me.user.role === "employee" ? (
                            <div className="flex items-center gap-2">
                                <span>{t("profile.admission")}:</span>
                                <Badge tone={me.user.admitted ? "primary" : "warning"}>{me.user.admitted ? t("team.admitted") : t("team.notAdmitted")}</Badge>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
                <ChangePassword />
                <Sessions />
            </div>
        </>
    );
}

function ChangePassword() {
    const [form, setForm] = useState({ currentPassword: "", newPassword: "", repeat: "" });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    async function submit() {
        setMessage(null);
        if (form.newPassword !== form.repeat) {
            setFields({ repeat: t("validation.passwordMismatch") });
            return;
        }
        setBusy(true);
        setFields({});
        try {
            await api("/api/me/password", { method: "POST", body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
            setForm({ currentPassword: "", newPassword: "", repeat: "" });
            setMessage({ kind: "success", text: t("profile.passwordChanged") });
        } catch (caught) {
            setMessage({ kind: "error", text: errorMessage(caught) });
            if (caught instanceof ApiError) setFields(caught.fields);
        } finally {
            setBusy(false);
        }
    }
    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("profile.changePassword")}</CardTitle>
            </CardHeader>
            <CardContent>
                <Form onSubmit={submit} busy={busy} canSubmit={Object.values(form).every((value) => value !== "")}>
                    {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
                    <Field label={t("profile.currentPassword")} error={fields["currentPassword"]}>
                        <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => update("currentPassword", event.target.value)} />
                    </Field>
                    <Field label={t("profile.newPassword")} hint={t("invite.passwordHint")} error={fields["newPassword"]}>
                        <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => update("newPassword", event.target.value)} />
                    </Field>
                    <Field label={t("invite.passwordRepeat")} error={fields["repeat"]}>
                        <Input type="password" autoComplete="new-password" value={form.repeat} onChange={(event) => update("repeat", event.target.value)} />
                    </Field>
                </Form>
            </CardContent>
        </Card>
    );
}

function Sessions() {
    const { me } = useSession();
    const [actionError, setActionError] = useState<string | null>(null);
    const list = useApiData("sessions", (signal) => api<{ sessions: SessionRow[] }>("/api/me/sessions", { signal }).then((result) => result.sessions));
    const rows = list.data;
    const error = list.error ?? actionError;
    const load = async () => {
        setActionError(null);
        list.reload();
    };

    async function revoke(row: SessionRow) {
        try {
            await api(`/api/me/sessions/${row.id}`, { method: "DELETE" });
            if (row.current) window.location.assign("/login");
            else await load();
        } catch (caught) {
            setActionError(errorMessage(caught));
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("profile.sessions")}</CardTitle>
            </CardHeader>
            {error ? (
                <CardContent className="flex flex-wrap items-center gap-2">
                    <FormMessage kind="error">{error}</FormMessage>
                    <Button variant="secondary" onClick={() => void load()}>
                        {t("common.retry")}
                    </Button>
                </CardContent>
            ) : rows === null ? (
                <CardContent>
                    <Spinner label={t("common.loading")} />
                </CardContent>
            ) : (
                <ul className="divide-y divide-border">
                    {rows.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                                <div className="truncate" title={row.userAgent ?? ""}>
                                    {row.userAgent ?? t("profile.device")}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {t("profile.lastSeen")}: {formatDateTime(row.lastSeenAt, me.company.timezone)}
                                </div>
                            </div>
                            {row.current ? <Badge tone="primary">{t("profile.thisSession")}</Badge> : null}
                            <Button variant="danger-ghost" size="sm" onClick={() => void revoke(row)}>
                                {t("profile.revokeSession")}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
