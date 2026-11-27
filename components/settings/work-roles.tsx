"use client";

import { Archive, BadgeCheck, Pencil, Plus, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { cn } from "../../lib/utils.ts";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Input } from "../ui/input.tsx";

type WorkRole = { id: string; name: string; sections: string[]; archived: boolean; people: number };

const SECTIONS = [
    { key: "crm", label: "CRM" },
    { key: "kpi", label: "KPI" },
    { key: "stats", label: () => t("nav.stats") },
] as const;
const sectionLabel = (key: string) => {
    const item = SECTIONS.find((section) => section.key === key);
    return item ? (typeof item.label === "function" ? item.label() : item.label) : key;
};

/** Рабочие роли (должности): какие рабочие разделы открыты */
export function WorkRolesSettings() {
    const list = useApiData("work-roles", (signal) => api<{ workRoles: WorkRole[] }>("/api/work-roles", { signal }).then((result) => result.workRoles));
    const [dialog, setDialog] = useState<WorkRole | "new" | null>(null);
    if (list.error && !list.data) return <ErrorRetry message={list.error} onRetry={list.reload} />;
    if (!list.data) return <Spinner label={t("common.loading")} />;
    return (
        <div className="grid max-w-5xl gap-4">
            <p className="max-w-3xl text-sm text-muted-foreground">{t("workRoles.hint")}</p>
            {list.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("workRoles.empty")}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.data.map((role) => (
                    <div key={role.id} className={cn("lift grid gap-3 rounded-2xl border border-border bg-surface p-5", role.archived && "opacity-60")}>
                        <div className="flex items-start justify-between gap-2">
                            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                                <BadgeCheck className="size-5" />
                            </span>
                            {role.archived ? <StatusPill>{t("workRoles.archived")}</StatusPill> : null}
                        </div>
                        <div>
                            <div className="text-[17px] font-bold break-anywhere">{role.name}</div>
                            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                                <Users className="size-3.5" />
                                {t("workRoles.people", { count: role.people })}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {role.sections.length ? role.sections.map((key) => <StatusPill key={key} tone="info">{sectionLabel(key)}</StatusPill>) : <StatusPill>{t("access.noSections")}</StatusPill>}
                        </div>
                        <div>
                            <Button variant="ghost" size="sm" onClick={() => setDialog(role)} aria-label={`${t("workRoles.edit")}: ${role.name}`}>
                                <Pencil className="size-3.5" />
                                {t("workRoles.edit")}
                            </Button>
                        </div>
                    </div>
                ))}
                <button type="button" onClick={() => setDialog("new")} className="grid min-h-44 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-5 text-center transition-all hover:border-primary/60 hover:bg-primary/[0.06]">
                    <span className="grid justify-items-center gap-2">
                        <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                            <Plus className="size-5" />
                        </span>
                        <span className="font-bold text-primary">{t("workRoles.add")}</span>
                    </span>
                </button>
            </div>
            {dialog ? <WorkRoleDialog role={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} onSaved={list.reload} /> : null}
        </div>
    );
}

function WorkRoleDialog({ role, onClose, onSaved }: { role: WorkRole | null; onClose: () => void; onSaved: () => void }) {
    const [name, setName] = useState(role?.name ?? "");
    const [sections, setSections] = useState<string[]>(role?.sections ?? ["crm", "kpi", "stats"]);
    const action = useAction();
    const save = () =>
        action.run(async () => {
            if (role) await api(`/api/work-roles/${role.id}`, { method: "PATCH", body: { name, sections } });
            else await api("/api/work-roles", { method: "POST", body: { name, sections } });
            onSaved();
            onClose();
        });
    const archive = (archived: boolean) =>
        action.run(async () => {
            await api(`/api/work-roles/${role!.id}`, { method: "PATCH", body: { archived } });
            onSaved();
            onClose();
        });
    return (
        <Dialog open onClose={onClose} title={role ? role.name : t("workRoles.add")}>
            <Form
                variant="dialog"
                submitLabel={role ? t("common.save") : t("common.create")}
                busy={action.busy}
                canSubmit={name.trim().length >= 2}
                secondary={
                    role ? (
                        role.archived ? (
                            <Button variant="secondary" onClick={() => void archive(false)}>
                                <RotateCcw className="size-4" />
                                {t("workRoles.restore")}
                            </Button>
                        ) : (
                            <Button variant="danger" onClick={() => void archive(true)}>
                                <Archive className="size-4" />
                                {t("workRoles.archive")}
                            </Button>
                        )
                    ) : (
                        <Button variant="secondary" onClick={onClose}>
                            {t("common.cancel")}
                        </Button>
                    )
                }
                onSubmit={save}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <Field label={t("workRoles.name")}>
                    <Input value={name} maxLength={60} placeholder={t("workRoles.namePlaceholder")} onChange={(event) => setName(event.target.value)} data-autofocus />
                </Field>
                <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-semibold">{t("workRoles.sections")}</legend>
                    {SECTIONS.map((section) => (
                        <Checkbox
                            key={section.key}
                            label={sectionLabel(section.key)}
                            checked={sections.includes(section.key)}
                            onChange={(event) => setSections((current) => (event.target.checked ? [...current, section.key] : current.filter((key) => key !== section.key)))}
                        />
                    ))}
                </fieldset>
            </Form>
        </Dialog>
    );
}
