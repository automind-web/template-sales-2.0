"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { formatDateTime, t, type MessageKey } from "../../i18n/index.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession, type Role } from "../session.tsx";
import { Tag } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Select } from "../ui/input.tsx";
import { Table, Td, Th, THead, Tr } from "../ui/table.tsx";

export type Member = {
    id: string;
    login: string;
    displayName: string;
    role: Role;
    branchId: string | null;
    branchName: string | null;
    status: "active" | "disabled";
    lastLoginAt: number | null;
    admitted: boolean;
    canManage: boolean;
    isSelf: boolean;
};

export const roleLabel = (role: Role) => t(`role.${role}` as MessageKey);

export function useBranchQuery() {
    const { me } = useSession();
    return me.user.role === "director" && me.selectedBranchId ? `?branchId=${encodeURIComponent(me.selectedBranchId)}` : "";
}

/**
 * Участники: роль, филиал, допуск к CRM и доступ меняются прямо в таблице.
 * Изменение сохраняется сразу; права пересчитываются со следующего запроса сотрудника.
 */
export function MembersSettings() {
    const { me } = useSession();
    const query = useBranchQuery();
    const list = useApiData(`members${query}`, (signal) => api<{ users: Member[] }>(`/api/users${query}`, { signal }).then((result) => result.users));
    const [error, setError] = useState<string | null>(null);
    const [resetFor, setResetFor] = useState<Member | null>(null);
    const isDirector = me.user.role === "director";

    async function change(member: Member, path: string, method: "PATCH" | "PUT", body: unknown) {
        setError(null);
        try {
            await api(path, { method, body });
        } catch (caught) {
            setError(`${member.displayName}: ${errorMessage(caught)}`);
        } finally {
            list.reload();
        }
    }

    if (list.error && !list.data) return <ErrorRetry message={list.error} onRetry={list.reload} />;
    if (!list.data) return <Spinner label={t("common.loading")} />;
    if (list.data.length === 0) {
        return (
            <Card className="max-w-6xl">
                <EmptyState icon={Users} title={t("team.noMembers")} />
            </Card>
        );
    }

    return (
        <div className="grid max-w-6xl gap-3">
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Table aria-busy={list.loading}>
                <THead>
                    <tr>
                        <Th>{t("team.member")}</Th>
                        <Th>{t("common.role")}</Th>
                        <Th>{t("common.branch")}</Th>
                        <Th>{t("team.lastLogin")}</Th>
                        <Th className="text-right">{t("team.access")}</Th>
                        <Th>
                            <span className="sr-only">{t("common.actions")}</span>
                        </Th>
                    </tr>
                </THead>
                <tbody>
                    {list.data.map((member) => {
                        const editable = member.canManage && isDirector;
                        return (
                            <Tr key={member.id}>
                                <Td className="min-w-48">
                                    <div className="font-bold break-anywhere">
                                        {member.displayName} {member.isSelf ? <Tag>{t("team.you")}</Tag> : null}
                                    </div>
                                    <div className="text-[13px] text-muted-foreground">{member.login}</div>
                                </Td>
                                <Td className="min-w-48">
                                    {editable ? (
                                        <Select aria-label={`${t("common.role")}: ${member.displayName}`} value={member.role} onChange={(event) => void change(member, `/api/users/${member.id}`, "PATCH", { role: event.target.value, branchId: member.branchId ?? me.branches[0]?.id })}>
                                            {(["employee", "manager", "director"] as const).map((role) => (
                                                <option key={role} value={role}>
                                                    {roleLabel(role)}
                                                </option>
                                            ))}
                                        </Select>
                                    ) : (
                                        roleLabel(member.role)
                                    )}
                                </Td>
                                <Td className="min-w-48">
                                    {editable && member.role !== "director" ? (
                                        <Select aria-label={`${t("common.branch")}: ${member.displayName}`} value={member.branchId ?? ""} onChange={(event) => void change(member, `/api/users/${member.id}`, "PATCH", { branchId: event.target.value })}>
                                            {me.branches.map((branch) => (
                                                <option key={branch.id} value={branch.id}>
                                                    {branch.name}
                                                </option>
                                            ))}
                                        </Select>
                                    ) : (
                                        (member.branchName ?? t("common.none"))
                                    )}
                                </Td>
                                <Td className="text-[13px] whitespace-nowrap text-muted-foreground">{member.lastLoginAt ? formatDateTime(member.lastLoginAt, me.company.timezone) : t("team.never")}</Td>
                                <Td className="min-w-32">
                                    {member.canManage ? (
                                        <div className="grid justify-end gap-1.5">
                                            <OptimisticCheckbox label={t("team.active")} checked={member.status === "active"} onToggle={(next) => change(member, `/api/users/${member.id}`, "PATCH", { status: next ? "active" : "disabled" })} />
                                            {member.role === "employee" ? (
                                                <OptimisticCheckbox label={t("team.admittedLower")} checked={member.admitted} onToggle={(next) => change(member, `/api/users/${member.id}/admission`, "PUT", { admitted: next })} />
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="text-right">{member.status === "active" ? t("team.active") : t("team.disabled")}</div>
                                    )}
                                </Td>
                                <Td className="text-right">
                                    {member.canManage ? (
                                        <Button variant="secondary" size="sm" onClick={() => setResetFor(member)}>
                                            {t("team.resetCode")}
                                        </Button>
                                    ) : null}
                                </Td>
                            </Tr>
                        );
                    })}
                </tbody>
            </Table>
            <p className="text-[13px] text-muted-foreground">{t("team.accessHint")}</p>
            {resetFor ? <ResetCodeDialog member={resetFor} onClose={() => setResetFor(null)} /> : null}
        </div>
    );
}

/** Флажок переключается сразу; после ответа сервера показывает сохранённое состояние */
function OptimisticCheckbox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: (next: boolean) => Promise<void> }) {
    const [pending, setPending] = useState<boolean | null>(null);
    return (
        <Checkbox
            label={label}
            checked={pending ?? checked}
            disabled={pending !== null}
            onChange={(event) => {
                const next = event.target.checked;
                setPending(next);
                void onToggle(next).finally(() => setPending(null));
            }}
        />
    );
}

function ResetCodeDialog({ member, onClose }: { member: Member; onClose: () => void }) {
    const { me } = useSession();
    const [result, setResult] = useState<{ code: string; expiresAt: number } | null>(null);
    const action = useAction();
    return (
        <Dialog open onClose={onClose} title={t("reset.issueTitle")} description={`${member.displayName} · ${member.login}`}>
            {result ? (
                <div className="grid gap-3">
                    <FormMessage kind="success">{t("reset.issueResult", { name: member.displayName, date: formatDateTime(result.expiresAt, me.company.timezone) })}</FormMessage>
                    <p className="rounded-lg border border-border bg-muted px-3 py-3 text-center font-mono text-xl tracking-[0.2em] select-all">{result.code}</p>
                    <p className="text-[13px] text-muted-foreground">{t("reset.issueHowTo")}</p>
                </div>
            ) : (
                <Form
                    variant="dialog"
                    busy={action.busy}
                    submitLabel={t("reset.issueSubmit")}
                    secondary={
                        <Button variant="secondary" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                    }
                    onSubmit={() => action.run(async () => setResult(await api<{ code: string; expiresAt: number }>(`/api/users/${member.id}/reset-code`, { method: "POST" })))}
                >
                    {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                    <p className="text-sm">{t("reset.issueExplain")}</p>
                </Form>
            )}
        </Dialog>
    );
}
