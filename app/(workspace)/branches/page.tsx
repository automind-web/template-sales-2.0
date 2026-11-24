"use client";

import { useState } from "react";
import { PageHeader, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Badge, Card, EmptyState, Spinner } from "../../../components/ui/card.tsx";
import { Dialog } from "../../../components/ui/dialog.tsx";
import { Field, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { t } from "../../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../../lib/api.ts";
import { useApiData } from "../../../lib/use-api.ts";

type Branch = { id: string; name: string; city: string | null; archived: boolean; employees: number };

export default function BranchesPage() {
    return (
        <SectionGate section="branches">
            <Branches />
        </SectionGate>
    );
}

function Branches() {
    const { reload } = useSession();
    const [actionError, setActionError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Branch | "new" | null>(null);
    const list = useApiData("branches", (signal) => api<{ branches: Branch[] }>("/api/branches", { signal }).then((result) => result.branches));
    const items = list.data;
    const error = list.error ?? actionError;
    const load = async () => {
        setActionError(null);
        list.reload();
    };

    async function toggleArchive(branch: Branch) {
        try {
            await api(`/api/branches/${branch.id}`, { method: "PATCH", body: { archived: !branch.archived } });
            await Promise.all([load(), reload()]);
        } catch (caught) {
            setActionError(errorMessage(caught));
        }
    }

    return (
        <>
            <PageHeader title={t("branches.title")} actions={<Button onClick={() => setEditing("new")}>{t("branches.add")}</Button>} />
            {error ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <FormMessage kind="error">{error}</FormMessage>
                    <Button variant="secondary" onClick={() => void load()}>
                        {t("common.retry")}
                    </Button>
                </div>
            ) : null}
            {items === null ? (
                error ? null : <Spinner label={t("common.loading")} />
            ) : items.length === 0 ? (
                <Card>
                    <EmptyState title={t("branches.empty")}>
                        <Button onClick={() => setEditing("new")}>{t("branches.add")}</Button>
                    </EmptyState>
                </Card>
            ) : (
                <Card>
                    <ul className="divide-y divide-border">
                        {items.map((branch) => (
                            <li key={branch.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium break-anywhere">{branch.name}</div>
                                    <div className="text-xs text-muted-foreground break-anywhere">
                                        {branch.city ?? t("common.none")} · {t("branches.employees")}: {branch.employees}
                                    </div>
                                </div>
                                <Badge tone={branch.archived ? "neutral" : "success"}>{branch.archived ? t("branches.archived") : t("branches.active")}</Badge>
                                <Button variant="secondary" size="sm" onClick={() => setEditing(branch)}>
                                    {t("team.edit")}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => void toggleArchive(branch)}>
                                    {branch.archived ? t("branches.restore") : t("branches.archive")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            {editing ? (
                <BranchDialog
                    branch={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null);
                        await Promise.all([load(), reload()]);
                    }}
                />
            ) : null}
        </>
    );
}

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => Promise<void> }) {
    const [name, setName] = useState(branch?.name ?? "");
    const [city, setCity] = useState(branch?.city ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    async function submit() {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            if (branch) await api(`/api/branches/${branch.id}`, { method: "PATCH", body: { name, city } });
            else await api("/api/branches", { method: "POST", body: { name, city } });
            await onSaved();
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
            setBusy(false);
        }
    }

    return (
        <Dialog open onClose={onClose} title={branch ? branch.name : t("branches.add")}>
            <Form
                onSubmit={submit}
                busy={busy}
                canSubmit={name.trim().length >= 2}
                secondary={
                    <Button variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
            >
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                <Field label={t("branches.name")} error={fields["name"]}>
                    <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-autofocus />
                </Field>
                <Field label={t("branches.city")} optional error={fields["city"]}>
                    <Input value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} />
                </Field>
            </Form>
        </Dialog>
    );
}
