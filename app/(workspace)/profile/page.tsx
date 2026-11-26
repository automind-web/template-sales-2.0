"use client";

import Link from "next/link";
import { useState } from "react";
import { Page } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { StatusDot, Tag } from "../../../components/ui/badge.tsx";
import { Button, buttonVariants } from "../../../components/ui/button.tsx";
import { Meta, Section, Spinner } from "../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../components/ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input, Label } from "../../../components/ui/input.tsx";
import { formatDateTime, t, type MessageKey } from "../../../i18n/index.ts";
import { api, errorMessage } from "../../../lib/api.ts";
import { useAction } from "../../../lib/use-action.ts";
import { useApiData } from "../../../lib/use-api.ts";

type SessionRow = { id: string; current: boolean; createdAt: number; lastSeenAt: number; userAgent: string | null };

export default function ProfilePage() {
    const { me } = useSession();
    return (
        <Page title={t("profile.title")}>
            <div className="grid max-w-4xl gap-4">
                <PersonalData />
                {me.user.role === "employee" ? (
                    <Section title={t("profile.admission")}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StatusDot tone={me.user.admitted ? "success" : "warning"}>{me.user.admitted ? t("profile.admitted") : t("profile.notAdmitted")}</StatusDot>
                            {!me.user.admitted ? (
                                <Link href="/training" className={buttonVariants({ variant: "secondary" })}>
                                    {t("nav.training")}
                                </Link>
                            ) : null}
                        </div>
                    </Section>
                ) : null}
                <ChangePassword />
                <Sessions />
                <Footer />
            </div>
        </Page>
    );
}

function PersonalData() {
    const { me, reload } = useSession();
    const [name, setName] = useState(me.user.displayName);
    const action = useAction();
    const changed = name.trim() !== me.user.displayName;
    const branch = me.user.role === "director" ? t("profile.allBranches") : (me.user.branchName ?? t("common.none"));
    return (
        <Section title={t("profile.personal")}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Meta label={t("profile.company")}>{me.company.name}</Meta>
                <Meta label={t("common.role")}>{t(`role.${me.user.role}` as MessageKey)}</Meta>
                <Meta label={t("common.branch")}>{branch}</Meta>
                <Meta label={t("common.login")}>{me.user.login}</Meta>
            </div>
            <form
                className="mt-4 grid gap-1.5"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (changed) void action.run(async () => api("/api/me", { method: "PATCH", body: { displayName: name } }).then(reload));
                }}
            >
                <Label htmlFor="profile-name">{t("common.name")}</Label>
                <div className="flex gap-2">
                    <Input id="profile-name" value={name} maxLength={80} autoComplete="name" aria-invalid={action.error ? true : undefined} onChange={(event) => setName(event.target.value)} />
                    <Button type="submit" variant="secondary" disabled={!changed || action.busy}>
                        {t("common.save")}
                    </Button>
                </div>
                {action.error ? (
                    <p role="alert" className="text-xs font-semibold text-danger">
                        {action.fields["displayName"] ?? action.error}
                    </p>
                ) : null}
            </form>
        </Section>
    );
}

function ChangePassword() {
    const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
    const [done, setDone] = useState(false);
    const action = useAction();
    const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
    return (
        <Section title={t("profile.password")}>
            <Form
                submitLabel={t("profile.changePassword")}
                busy={action.busy}
                canSubmit={form.currentPassword !== "" && form.newPassword !== ""}
                onSubmit={async () => {
                    setDone(false);
                    if (await action.run(async () => api("/api/me/password", { method: "POST", body: form }))) {
                        setForm({ currentPassword: "", newPassword: "" });
                        setDone(true);
                    }
                }}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {done ? <FormMessage kind="success">{t("profile.passwordChanged")}</FormMessage> : null}
                <FieldGrid>
                    <Field label={t("profile.currentPassword")} error={action.fields["currentPassword"]}>
                        <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => update("currentPassword", event.target.value)} />
                    </Field>
                    <Field label={t("profile.newPassword")} hint={t("invite.passwordHint")} error={action.fields["newPassword"]}>
                        <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(event) => update("newPassword", event.target.value)} />
                    </Field>
                </FieldGrid>
            </Form>
        </Section>
    );
}

function Sessions() {
    const { me } = useSession();
    const [error, setError] = useState<string | null>(null);
    const list = useApiData("sessions", (signal) => api<{ sessions: SessionRow[] }>("/api/me/sessions", { signal }).then((result) => result.sessions));

    async function revoke(row: SessionRow) {
        setError(null);
        try {
            await api(`/api/me/sessions/${row.id}`, { method: "DELETE" });
            if (row.current) window.location.assign("/login");
            else list.reload();
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    return (
        <Section title={t("profile.sessions")}>
            {error ? (
                <div className="mb-3">
                    <FormMessage kind="error">{error}</FormMessage>
                </div>
            ) : null}
            {list.error && !list.data ? (
                <ErrorRetry message={list.error} onRetry={list.reload} />
            ) : !list.data ? (
                <Spinner label={t("common.loading")} />
            ) : (
                <ul className="-mx-5 -mb-5 divide-y divide-border border-t border-border">
                    {list.data.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                            <div className="min-w-0 flex-1">
                                <div className="truncate" title={row.userAgent ?? ""}>
                                    {row.userAgent ?? t("profile.device")} {row.current ? <Tag>{t("profile.thisSession")}</Tag> : null}
                                </div>
                                <div className="text-[13px] text-muted-foreground">
                                    {t("profile.lastSeen")}: {formatDateTime(row.lastSeenAt, me.company.timezone)}
                                </div>
                            </div>
                            <Button variant="danger" size="sm" onClick={() => void revoke(row)}>
                                {t("profile.revokeSession")}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

function Footer() {
    const { me } = useSession();
    async function logout() {
        try {
            await api("/api/auth/logout", { method: "POST" });
        } finally {
            window.location.assign("/login");
        }
    }
    return (
        <Section>
            <div className="flex flex-wrap items-center justify-between gap-2">
                {me.sections.settings ? (
                    <Link href="/settings" className={buttonVariants({ variant: "secondary" })}>
                        {t("nav.settings")}
                    </Link>
                ) : (
                    <span />
                )}
                <Button variant="danger" onClick={() => void logout()}>
                    {t("nav.logout")}
                </Button>
            </div>
        </Section>
    );
}
