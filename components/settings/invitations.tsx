"use client";

import { useState } from "react";
import { companyConfig } from "../../config/company.ts";
import { formatDateTime, t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { CopyLink } from "../copy-link.tsx";
import { useSession, type Role } from "../session.tsx";
import { Button } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";
import { ListCard, ListRow } from "../ui/table.tsx";
import { roleLabel, useBranchQuery } from "./members.tsx";

type Invitation = {
    id: string;
    role: Role;
    branchName: string | null;
    note: string | null;
    expiresAt: number;
    status: "active" | "used" | "expired" | "revoked";
    usedBy: string | null;
};

export function InvitationsSettings() {
    const query = useBranchQuery();
    const list = useApiData(`invitations${query}`, (signal) => api<{ invitations: Invitation[] }>(`/api/invitations${query}`, { signal }).then((result) => result.invitations));
    return (
        <div className="grid max-w-5xl gap-4">
            <NewInvitation onCreated={list.reload} />
            {list.error && !list.data ? (
                <ErrorRetry message={list.error} onRetry={list.reload} />
            ) : !list.data ? (
                <Spinner label={t("common.loading")} />
            ) : list.data.length === 0 ? (
                <Card>
                    <EmptyState title={t("team.noInvitations")} />
                </Card>
            ) : (
                <ListCard>
                    {list.data.map((invitation) => (
                        <InvitationRow key={invitation.id} invitation={invitation} onChanged={list.reload} />
                    ))}
                </ListCard>
            )}
        </div>
    );
}

function NewInvitation({ onCreated }: { onCreated: () => void }) {
    const { me } = useSession();
    const isDirector = me.user.role === "director";
    const defaultBranch = isDirector ? (me.selectedBranchId && me.selectedBranchId !== "*" ? me.selectedBranchId : me.branches.length === 1 ? (me.branches[0]?.id ?? "") : "") : (me.user.branchId ?? "");
    const [role, setRole] = useState<Role>("employee");
    const [branchId, setBranchId] = useState(defaultBranch);
    const [note, setNote] = useState("");
    const [ttlHours, setTtlHours] = useState(String(companyConfig.invitationTtlHours));
    const [result, setResult] = useState<{ url: string; expiresAt: number } | null>(null);
    const action = useAction();
    const needsBranch = role !== "director";

    return (
        <Card className="p-5">
            <h2 className="mb-4 text-[17px] font-bold">{t("team.inviteTitle")}</h2>
            {isDirector && me.branches.length === 0 ? (
                <div className="mb-4">
                    <FormMessage kind="info">{t("branches.empty")}</FormMessage>
                </div>
            ) : null}
            <Form
                busy={action.busy}
                canSubmit={(!needsBranch || branchId !== "") && ttlHours !== ""}
                submitLabel={t("team.createLink")}
                onSubmit={async () => {
                    setResult(null);
                    await action.run(async () => {
                        const created = await api<{ path: string; expiresAt: number }>("/api/invitations", {
                            method: "POST",
                            body: { role, branchId: needsBranch ? branchId : null, note, ttlHours: Number(ttlHours) },
                        });
                        setResult({ url: `${window.location.origin}${created.path}`, expiresAt: created.expiresAt });
                        setNote("");
                        onCreated();
                    });
                }}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <FieldGrid>
                    <Field label={t("common.role")} error={action.fields["role"]}>
                        <Select value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={!isDirector}>
                            <option value="employee">{roleLabel("employee")}</option>
                            {isDirector ? <option value="manager">{roleLabel("manager")}</option> : null}
                            {isDirector ? <option value="director">{roleLabel("director")}</option> : null}
                        </Select>
                    </Field>
                    {isDirector && needsBranch ? (
                        <Field label={t("common.branch")} error={action.fields["branchId"]}>
                            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                                {me.branches.length !== 1 ? <option value="">{t("common.choose")}</option> : null}
                                {me.branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : null}
                    <Field label={t("team.inviteNote")} error={action.fields["note"]}>
                        <Input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
                    </Field>
                    <Field label={t("owner.ttl")} error={action.fields["ttlHours"]}>
                        <Input type="number" inputMode="numeric" min={1} max={168} value={ttlHours} onChange={(event) => setTtlHours(event.target.value)} />
                    </Field>
                </FieldGrid>
                {result ? (
                    <div className="grid gap-2">
                        <FormMessage kind="success">{t("team.inviteCreated", { date: formatDateTime(result.expiresAt, me.company.timezone) })}</FormMessage>
                        <CopyLink url={result.url} />
                    </div>
                ) : null}
            </Form>
        </Card>
    );
}

function InvitationRow({ invitation, onChanged }: { invitation: Invitation; onChanged: () => void }) {
    const { me } = useSession();
    const action = useAction();
    const statusLine = (() => {
        switch (invitation.status) {
            case "active":
                return t("team.inviteValidUntil", { date: formatDateTime(invitation.expiresAt, me.company.timezone) });
            case "used":
                return t("team.inviteUsedBy", { name: invitation.usedBy ?? "" });
            case "revoked":
                return t("team.inviteStatus.revoked");
            default:
                return t("team.inviteStatus.expired");
        }
    })();
    return (
        <ListRow>
            <div className="min-w-0 flex-1">
                <div className="break-anywhere">
                    <span className="font-bold">{roleLabel(invitation.role)}</span>
                    {[invitation.branchName, invitation.note].filter(Boolean).map((part) => ` · ${part}`)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">{statusLine}</div>
                {action.error ? <p className="mt-1 text-[13px] text-danger">{action.error}</p> : null}
            </div>
            {invitation.status === "active" ? (
                <Button variant="danger" size="sm" disabled={action.busy} onClick={() => void action.run(async () => api(`/api/invitations/${invitation.id}/revoke`, { method: "POST" }).then(onChanged))}>
                    {t("team.revokeInvite")}
                </Button>
            ) : null}
        </ListRow>
    );
}
