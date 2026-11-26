"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";
import { ListCard, ListRow } from "../ui/table.tsx";

type Branch = { id: string; name: string; city: string | null; archived: boolean; employees: number };

export function BranchesSettings() {
    const { reload: reloadSession } = useSession();
    const list = useApiData("branches", (signal) => api<{ branches: Branch[] }>("/api/branches", { signal }).then((result) => result.branches));
    const [creating, setCreating] = useState(false);
    const refresh = () => {
        list.reload();
        void reloadSession();
    };

    return (
        <div className="grid max-w-5xl gap-4">
            <div>
                <Button onClick={() => setCreating(true)}>{t("branches.add")}</Button>
            </div>
            {list.error && !list.data ? (
                <ErrorRetry message={list.error} onRetry={list.reload} />
            ) : !list.data ? (
                <Spinner label={t("common.loading")} />
            ) : list.data.length === 0 ? (
                <Card>
                    <EmptyState icon={Building2} title={t("branches.emptyTitle")}>
                        {t("branches.empty")}
                    </EmptyState>
                </Card>
            ) : (
                <ListCard>
                    {list.data.map((branch) => (
                        <BranchRow key={`${branch.id}-${branch.name}-${branch.city}-${branch.archived}`} branch={branch} onChanged={refresh} />
                    ))}
                </ListCard>
            )}
            {creating ? <CreateBranchDialog onClose={() => setCreating(false)} onCreated={refresh} /> : null}
        </div>
    );
}

function BranchRow({ branch, onChanged }: { branch: Branch; onChanged: () => void }) {
    const [name, setName] = useState(branch.name);
    const [city, setCity] = useState(branch.city ?? "");
    const action = useAction();
    const changed = name !== branch.name || city !== (branch.city ?? "");

    return (
        <ListRow className="block">
            <form
                className="grid gap-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (changed) void action.run(async () => api(`/api/branches/${branch.id}`, { method: "PATCH", body: { name, city } }).then(onChanged));
                }}
            >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <Input aria-label={t("branches.name")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={branch.archived} />
                    <Input aria-label={t("branches.city")} placeholder={t("branches.city")} value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} disabled={branch.archived} />
                </div>
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <div className="flex flex-wrap items-center gap-2">
                    {branch.archived ? (
                        <>
                            <StatusPill>{t("branches.archived")}</StatusPill>
                            <Button variant="secondary" size="sm" disabled={action.busy} onClick={() => void action.run(async () => api(`/api/branches/${branch.id}`, { method: "PATCH", body: { archived: false } }).then(onChanged))}>
                                {t("branches.restore")}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button type="submit" variant="secondary" size="sm" disabled={!changed || action.busy}>
                                {t("common.save")}
                            </Button>
                            <Button variant="danger" size="sm" disabled={action.busy} onClick={() => void action.run(async () => api(`/api/branches/${branch.id}`, { method: "PATCH", body: { archived: true } }).then(onChanged))}>
                                {t("branches.archive")}
                            </Button>
                        </>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{t("branches.employeesCount", { count: branch.employees })}</span>
                </div>
            </form>
        </ListRow>
    );
}

function CreateBranchDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [name, setName] = useState("");
    const [city, setCity] = useState("");
    const action = useAction();
    return (
        <Dialog open onClose={onClose} title={t("branches.add")}>
            <Form
                variant="dialog"
                submitLabel={t("common.create")}
                busy={action.busy}
                canSubmit={name.trim().length >= 2}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={async () => {
                    if (await action.run(async () => api("/api/branches", { method: "POST", body: { name, city } }))) {
                        onCreated();
                        onClose();
                    }
                }}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <FieldGrid>
                    <Field label={t("branches.name")} error={action.fields["name"]}>
                        <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-autofocus />
                    </Field>
                    <Field label={t("branches.city")} optional error={action.fields["city"]}>
                        <Input value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} />
                    </Field>
                </FieldGrid>
            </Form>
        </Dialog>
    );
}
