"use client";

import { Archive, Building2, MapPin, Pencil, Plus, RotateCcw, Users } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { cn } from "../../lib/utils.ts";
import { useSession } from "../session.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input } from "../ui/input.tsx";

type Branch = { id: string; name: string; city: string | null; archived: boolean; employees: number };

/** Филиалы карточками; новый филиал — отдельная карточка с плюсом */
export function BranchesSettings() {
    const { reload: reloadSession } = useSession();
    const list = useApiData("branches", (signal) => api<{ branches: Branch[] }>("/api/branches", { signal }).then((result) => result.branches));
    const [dialog, setDialog] = useState<Branch | "new" | null>(null);
    const refresh = () => {
        list.reload();
        void reloadSession();
    };
    if (list.error && !list.data) return <ErrorRetry message={list.error} onRetry={list.reload} />;
    if (!list.data) return <Spinner label={t("common.loading")} />;
    const empty = list.data.length === 0;

    return (
        <div className="grid max-w-5xl gap-4">
            {empty ? <p className="text-sm text-muted-foreground">{t("branches.empty")}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.data.map((branch) => (
                    <div key={branch.id} className={cn("group relative grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_#1d24330a] transition-all hover:-translate-y-0.5 hover:shadow-md", branch.archived && "opacity-60")}>
                        <div className="flex items-start justify-between gap-2">
                            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                                <Building2 className="size-5" />
                            </span>
                            {branch.archived ? <StatusPill>{t("branches.archived")}</StatusPill> : null}
                        </div>
                        <div className="min-w-0">
                            <div className="text-[17px] font-bold break-anywhere">{branch.name}</div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                                {branch.city ? (
                                    <span className="inline-flex items-center gap-1">
                                        <MapPin className="size-3.5" />
                                        {branch.city}
                                    </span>
                                ) : null}
                                <span className="inline-flex items-center gap-1">
                                    <Users className="size-3.5" />
                                    {t("branches.employeesCount", { count: branch.employees })}
                                </span>
                            </div>
                        </div>
                        <div>
                            <Button variant="ghost" size="sm" onClick={() => setDialog(branch)} aria-label={`${t("branches.edit")}: ${branch.name}`}>
                                <Pencil className="size-3.5" />
                                {t("branches.edit")}
                            </Button>
                        </div>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => setDialog("new")}
                    className={cn(
                        "grid min-h-44 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-5 text-center transition-all hover:border-primary/60 hover:bg-primary/[0.06]",
                        empty && "border-primary/50"
                    )}
                >
                    <span className="grid justify-items-center gap-2">
                        <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                            <Plus className="size-5" />
                        </span>
                        <span className="font-bold text-primary">{t("branches.add")}</span>
                        <span className="text-[13px] text-muted-foreground">{t("branches.addHint")}</span>
                    </span>
                </button>
            </div>
            {dialog ? <BranchDialog branch={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} onSaved={refresh} /> : null}
        </div>
    );
}

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => void }) {
    const [name, setName] = useState(branch?.name ?? "");
    const [city, setCity] = useState(branch?.city ?? "");
    const action = useAction();
    const save = () =>
        action.run(async () => {
            if (branch) await api(`/api/branches/${branch.id}`, { method: "PATCH", body: { name, city } });
            else await api("/api/branches", { method: "POST", body: { name, city } });
            onSaved();
            onClose();
        });
    const archive = (archived: boolean) =>
        action.run(async () => {
            await api(`/api/branches/${branch!.id}`, { method: "PATCH", body: { archived } });
            onSaved();
            onClose();
        });
    return (
        <Dialog open onClose={onClose} title={branch ? t("branches.editTitle") : t("branches.add")} description={branch ? undefined : t("branches.addHint")}>
            <Form
                variant="dialog"
                submitLabel={branch ? t("common.save") : t("common.create")}
                busy={action.busy}
                canSubmit={name.trim().length >= 2 && !branch?.archived}
                secondary={
                    branch ? (
                        branch.archived ? (
                            <Button variant="secondary" onClick={() => void archive(false)}>
                                <RotateCcw className="size-4" />
                                {t("branches.restore")}
                            </Button>
                        ) : (
                            <Button variant="danger" onClick={() => void archive(true)}>
                                <Archive className="size-4" />
                                {t("branches.archive")}
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
                <Field label={t("branches.name")} error={action.fields["name"]}>
                    <Input value={name} maxLength={80} placeholder={t("branches.namePlaceholder")} onChange={(event) => setName(event.target.value)} data-autofocus disabled={branch?.archived} />
                </Field>
                <Field label={t("branches.city")} optional error={action.fields["city"]}>
                    <Input value={city} maxLength={80} placeholder={t("branches.cityPlaceholder")} onChange={(event) => setCity(event.target.value)} disabled={branch?.archived} />
                </Field>
            </Form>
        </Dialog>
    );
}
