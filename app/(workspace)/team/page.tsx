"use client";

import { useState } from "react";
import { PageHeader, SectionGate } from "../../../components/app-shell.tsx";
import { CopyLink } from "../../../components/copy-link.tsx";
import { useSession, type Role } from "../../../components/session.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Badge, Card, EmptyState, Spinner } from "../../../components/ui/card.tsx";
import { Dialog } from "../../../components/ui/dialog.tsx";
import { Field, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input, Select } from "../../../components/ui/input.tsx";
import { formatDateTime, t, type MessageKey } from "../../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../../lib/api.ts";
import { useApiData } from "../../../lib/use-api.ts";
import { cn } from "../../../lib/utils.ts";

type Member = {
    id: string;
    login: string;
    displayName: string;
    role: Role;
    branchId: string | null;
    branchName: string | null;
    status: "active" | "disabled";
    lastLoginAt: number | null;
    admitted: boolean;
    admission: { source: string; grantedAt: number } | null;
    canManage: boolean;
    isSelf: boolean;
};

type Invitation = {
    id: string;
    role: Role;
    branchName: string | null;
    note: string | null;
    createdAt: number;
    expiresAt: number;
    status: "active" | "used" | "expired" | "revoked";
    usedBy: string | null;
};

const roleLabel = (role: Role) => t(`role.${role}` as MessageKey);

export default function TeamPage() {
    return (
        <SectionGate section="team">
            <Team />
        </SectionGate>
    );
}

function Team() {
    const { me } = useSession();
    const [tab, setTab] = useState<"members" | "invitations">("members");
    const [actionError, setActionError] = useState<string | null>(null);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [dialog, setDialog] = useState<{ kind: "reset" | "edit" | "admission" | "status"; member: Member } | null>(null);

    const branchQuery = me.user.role === "director" && me.selectedBranchId ? `?branchId=${encodeURIComponent(me.selectedBranchId)}` : "";

    const team = useApiData(`team${branchQuery}`, (signal) =>
        Promise.all([
            api<{ users: Member[] }>(`/api/users${branchQuery}`, { signal }),
            api<{ invitations: Invitation[] }>(`/api/invitations${branchQuery}`, { signal }),
        ]).then(([usersResult, invitationsResult]) => ({ members: usersResult.users, invitations: invitationsResult.invitations }))
    );
    const members = team.data?.members ?? null;
    const invitations = team.data?.invitations ?? null;
    const error = team.error ?? actionError;
    const load = async () => {
        setActionError(null);
        team.reload();
    };

    async function revoke(id: string) {
        try {
            await api(`/api/invitations/${id}/revoke`, { method: "POST" });
            await load();
        } catch (caught) {
            setActionError(errorMessage(caught));
        }
    }

    const noBranches = me.user.role === "director" && me.branches.length === 0;

    return (
        <>
            <PageHeader
                title={t("team.title")}
                actions={
                    <Button onClick={() => setInviteOpen(true)} disabled={noBranches && me.user.role !== "director"}>
                        {t("team.invite")}
                    </Button>
                }
            />
            {noBranches ? (
                <div className="mb-3">
                    <FormMessage kind="info">
                        {t("branches.empty")}{" "}
                        <a className="text-primary underline" href="/branches">
                            {t("branches.add")}
                        </a>
                    </FormMessage>
                </div>
            ) : null}
            <div role="tablist" aria-label={t("team.title")} className="mb-3 flex gap-1 border-b border-border">
                {(["members", "invitations"] as const).map((key) => (
                    <button
                        key={key}
                        role="tab"
                        type="button"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                    >
                        {t(key === "members" ? "team.members" : "team.invitations")}
                    </button>
                ))}
            </div>
            {error ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <FormMessage kind="error">{error}</FormMessage>
                    <Button variant="secondary" onClick={() => void load()}>
                        {t("common.retry")}
                    </Button>
                </div>
            ) : null}
            {tab === "members" ? (
                members === null ? (
                    error ? null : <Spinner label={t("common.loading")} />
                ) : members.length === 0 ? (
                    <Card>
                        <EmptyState title={t("team.noMembers")} />
                    </Card>
                ) : (
                    <Card aria-busy={team.loading} className={team.loading ? "opacity-60" : undefined}>
                        <ul className="divide-y divide-border">
                            {members.map((member) => (
                                <MemberRow key={member.id} member={member} viewerRole={me.user.role} onAction={(kind) => setDialog({ kind, member })} />
                            ))}
                        </ul>
                    </Card>
                )
            ) : invitations === null ? (
                error ? null : <Spinner label={t("common.loading")} />
            ) : invitations.length === 0 ? (
                <Card>
                    <EmptyState title={t("team.noInvitations")} />
                </Card>
            ) : (
                <Card>
                    <ul className="divide-y divide-border">
                        {invitations.map((invitation) => (
                            <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium break-anywhere">{invitation.note || roleLabel(invitation.role)}</div>
                                    <div className="text-xs text-muted-foreground break-anywhere">
                                        {roleLabel(invitation.role)}
                                        {invitation.branchName ? ` · ${invitation.branchName}` : ""} · {t("common.expiresAt")}: {formatDateTime(invitation.expiresAt, me.company.timezone)}
                                        {invitation.usedBy ? ` · ${invitation.usedBy}` : ""}
                                    </div>
                                </div>
                                <Badge tone={invitation.status === "active" ? "primary" : invitation.status === "used" ? "success" : "neutral"}>{t(`team.inviteStatus.${invitation.status}` as MessageKey)}</Badge>
                                {invitation.status === "active" ? (
                                    <Button variant="danger-ghost" size="sm" onClick={() => void revoke(invitation.id)}>
                                        {t("team.revokeInvite")}
                                    </Button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <InviteDialog
                key={inviteOpen ? "open" : "closed"}
                open={inviteOpen}
                onClose={() => setInviteOpen(false)}
                onCreated={() => {
                    void load();
                }}
            />
            {dialog?.kind === "reset" ? <ResetCodeDialog member={dialog.member} onClose={() => setDialog(null)} /> : null}
            {dialog?.kind === "edit" ? <EditMemberDialog member={dialog.member} onClose={() => setDialog(null)} onSaved={load} /> : null}
            {dialog?.kind === "admission" ? <AdmissionDialog member={dialog.member} onClose={() => setDialog(null)} onSaved={load} /> : null}
            {dialog?.kind === "status" ? <StatusDialog member={dialog.member} onClose={() => setDialog(null)} onSaved={load} /> : null}
        </>
    );
}

function MemberRow({ member, viewerRole, onAction }: { member: Member; viewerRole: Role; onAction: (kind: "reset" | "edit" | "admission" | "status") => void }) {
    const { me } = useSession();
    return (
        <li className="grid gap-2 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto] md:items-center">
            <div className="min-w-0">
                <div className="font-medium break-anywhere">
                    {member.displayName}
                    {member.isSelf ? <span className="ml-1 text-xs text-muted-foreground">({t("team.you")})</span> : null}
                </div>
                <div className="text-xs text-muted-foreground break-anywhere">
                    {member.login} · {roleLabel(member.role)}
                    {member.branchName ? ` · ${member.branchName}` : ""}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={member.status === "active" ? "success" : "danger"}>{member.status === "active" ? t("team.statusActive") : t("team.statusDisabled")}</Badge>
                {member.role === "employee" ? <Badge tone={member.admitted ? "primary" : "warning"}>{member.admitted ? t("team.admitted") : t("team.notAdmitted")}</Badge> : null}
                <span className="text-xs text-muted-foreground">
                    {t("team.lastLogin")}: {member.lastLoginAt ? formatDateTime(member.lastLoginAt, me.company.timezone) : t("team.never")}
                </span>
            </div>
            {member.canManage ? (
                <div className="flex flex-wrap gap-1 md:justify-end">
                    {member.role === "employee" ? (
                        <Button variant="secondary" size="sm" onClick={() => onAction("admission")}>
                            {member.admitted ? t("team.revokeAdmission") : t("team.grantAdmission")}
                        </Button>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={() => onAction("reset")}>
                        {t("team.resetCode")}
                    </Button>
                    {viewerRole === "director" ? (
                        <Button variant="secondary" size="sm" onClick={() => onAction("edit")}>
                            {t("team.edit")}
                        </Button>
                    ) : null}
                    <Button variant={member.status === "active" ? "danger-ghost" : "secondary"} size="sm" onClick={() => onAction("status")}>
                        {member.status === "active" ? t("team.disable") : t("team.enable")}
                    </Button>
                </div>
            ) : (
                <div />
            )}
        </li>
    );
}

function useFormState() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});
    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            await action();
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
        } finally {
            setBusy(false);
        }
    }
    return { busy, error, fields, run };
}

function InviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
    const { me } = useSession();
    const isDirector = me.user.role === "director";
    const defaultBranch = isDirector ? (me.selectedBranchId && me.selectedBranchId !== "*" ? me.selectedBranchId : me.branches.length === 1 ? (me.branches[0]?.id ?? "") : "") : (me.user.branchId ?? "");
    const [role, setRole] = useState<Role>("employee");
    const [branchId, setBranchId] = useState(defaultBranch);
    const [note, setNote] = useState("");
    const [result, setResult] = useState<{ url: string; expiresAt: number } | null>(null);
    const state = useFormState();

    const needsBranch = role !== "director";
    return (
        <Dialog open={open} onClose={onClose} title={t("team.inviteTitle")}>
            {result ? (
                <div className="grid gap-3">
                    <FormMessage kind="success">{t("team.inviteCreated", { date: formatDateTime(result.expiresAt, me.company.timezone) })}</FormMessage>
                    <CopyLink url={result.url} />
                    <div>
                        <Button variant="secondary" onClick={() => setResult(null)}>
                            {t("team.invite")}
                        </Button>
                    </div>
                </div>
            ) : (
                <Form
                    busy={state.busy}
                    canSubmit={!needsBranch || branchId !== ""}
                    submitLabel={t("common.create")}
                    secondary={
                        <Button variant="ghost" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                    }
                    onSubmit={() =>
                        state.run(async () => {
                            const created = await api<{ path: string; expiresAt: number }>("/api/invitations", {
                                method: "POST",
                                body: { role, branchId: needsBranch ? branchId : null, note },
                            });
                            setResult({ url: `${window.location.origin}${created.path}`, expiresAt: created.expiresAt });
                            onCreated();
                        })
                    }
                >
                    {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
                    <Field label={t("common.role")} error={state.fields["role"]}>
                        <Select value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={!isDirector} data-autofocus>
                            <option value="employee">{roleLabel("employee")}</option>
                            {isDirector ? <option value="manager">{roleLabel("manager")}</option> : null}
                            {isDirector ? <option value="director">{roleLabel("director")}</option> : null}
                        </Select>
                    </Field>
                    {needsBranch ? (
                        <Field label={t("common.branch")} error={state.fields["branchId"]}>
                            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!isDirector || me.branches.length === 1}>
                                {isDirector && me.branches.length > 1 ? <option value="">—</option> : null}
                                {me.branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : null}
                    <Field label={t("team.inviteNote")} optional error={state.fields["note"]}>
                        <Input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
                    </Field>
                </Form>
            )}
        </Dialog>
    );
}

function ResetCodeDialog({ member, onClose }: { member: Member; onClose: () => void }) {
    const { me } = useSession();
    const [result, setResult] = useState<{ code: string; expiresAt: number } | null>(null);
    const state = useFormState();
    return (
        <Dialog open onClose={onClose} title={t("reset.issueTitle")} description={member.displayName}>
            {result ? (
                <div className="grid gap-3">
                    <FormMessage kind="success">{t("reset.issueResult", { name: member.displayName, date: formatDateTime(result.expiresAt, me.company.timezone) })}</FormMessage>
                    <p className="rounded-md border border-border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest select-all">{result.code}</p>
                    <p className="text-xs text-muted-foreground">
                        {t("common.login")}: {member.login} · /reset
                    </p>
                </div>
            ) : (
                <Form
                    busy={state.busy}
                    submitLabel={t("common.create")}
                    secondary={
                        <Button variant="ghost" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                    }
                    onSubmit={() =>
                        state.run(async () => {
                            setResult(await api<{ code: string; expiresAt: number }>(`/api/users/${member.id}/reset-code`, { method: "POST" }));
                        })
                    }
                >
                    {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
                    <p className="text-sm">{t("reset.subtitle")}</p>
                </Form>
            )}
        </Dialog>
    );
}

function EditMemberDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => Promise<void> }) {
    const { me } = useSession();
    const [role, setRole] = useState<Role>(member.role);
    const [branchId, setBranchId] = useState(member.branchId ?? me.branches[0]?.id ?? "");
    const state = useFormState();
    const changed = role !== member.role || (role !== "director" && branchId !== member.branchId);
    return (
        <Dialog open onClose={onClose} title={t("team.editTitle")} description={member.displayName}>
            <Form
                busy={state.busy}
                canSubmit={changed && (role === "director" || branchId !== "")}
                secondary={
                    <Button variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    state.run(async () => {
                        await api(`/api/users/${member.id}`, { method: "PATCH", body: { role, branchId: role === "director" ? null : branchId } });
                        await onSaved();
                        onClose();
                    })
                }
            >
                {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
                <Field label={t("common.role")} error={state.fields["role"]}>
                    <Select value={role} onChange={(event) => setRole(event.target.value as Role)} data-autofocus>
                        {(["employee", "manager", "director"] as const).map((value) => (
                            <option key={value} value={value}>
                                {roleLabel(value)}
                            </option>
                        ))}
                    </Select>
                </Field>
                {role !== "director" ? (
                    <Field label={t("common.branch")} error={state.fields["branchId"]}>
                        <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                            {me.branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                ) : null}
            </Form>
        </Dialog>
    );
}

function AdmissionDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => Promise<void> }) {
    const [reason, setReason] = useState("");
    const state = useFormState();
    const grant = !member.admitted;
    return (
        <Dialog open onClose={onClose} title={grant ? t("team.grantAdmission") : t("team.revokeAdmission")} description={member.displayName}>
            <Form
                busy={state.busy}
                submitLabel={grant ? t("team.grantAdmission") : t("team.revokeAdmission")}
                secondary={
                    <Button variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    state.run(async () => {
                        await api(`/api/users/${member.id}/admission`, { method: "PUT", body: { admitted: grant, reason } });
                        await onSaved();
                        onClose();
                    })
                }
            >
                {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
                <Field label={t("team.admissionReason")} optional>
                    <Input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} data-autofocus />
                </Field>
            </Form>
        </Dialog>
    );
}

function StatusDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => Promise<void> }) {
    const state = useFormState();
    const disable = member.status === "active";
    return (
        <Dialog open onClose={onClose} title={disable ? t("team.disable") : t("team.enable")} description={member.displayName}>
            <Form
                busy={state.busy}
                submitLabel={disable ? t("team.disable") : t("team.enable")}
                secondary={
                    <Button variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    state.run(async () => {
                        await api(`/api/users/${member.id}`, { method: "PATCH", body: { status: disable ? "disabled" : "active" } });
                        await onSaved();
                        onClose();
                    })
                }
            >
                {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
            </Form>
        </Dialog>
    );
}
