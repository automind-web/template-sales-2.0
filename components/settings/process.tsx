"use client";

import { ArrowDown, ArrowUp, Flag, Plus, Trash2, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import type { FunnelConfig, FunnelStage } from "../../config/company.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import { Card, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Input } from "../ui/input.tsx";

type ProcessData = { funnel: FunnelConfig; employeesSeeBranch: boolean };

const REQUIRED: Array<"amount" | "comment" | "nextContactAt" | "lostReason"> = ["nextContactAt", "amount", "lostReason", "comment"];

/**
 * Переходы считаются сами: из любого рабочего этапа можно перейти в любой другой,
 * из «Отказа» — вернуть в первый этап. Директор правит только названия, порядок и состав.
 */
function withTransitions(stages: FunnelStage[]): FunnelConfig {
    const first = stages.find((stage) => !stage.terminal)?.key;
    const transitions: Record<string, string[]> = {};
    for (const stage of stages) {
        if (stage.terminal === "won") transitions[stage.key] = [];
        else if (stage.terminal === "lost") transitions[stage.key] = first ? [first] : [];
        else transitions[stage.key] = stages.filter((target) => target.key !== stage.key).map((target) => target.key);
    }
    return { stages, transitions };
}

/** Ключ нового этапа (неизменяемый, хранится в данных) */
function newStageKey() {
    return `stage_${Date.now().toString(36)}`;
}

export function ProcessSettings() {
    const data = useApiData("process", (signal) => api<ProcessData>("/api/settings/process", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    return <ProcessForm initial={data.data} />;
}

function ProcessForm({ initial }: { initial: ProcessData }) {
    const [stages, setStages] = useState(initial.funnel.stages);
    const [seeBranch, setSeeBranch] = useState(initial.employeesSeeBranch);
    const [saved, setSaved] = useState(false);
    const action = useAction();
    const open = stages.filter((stage) => !stage.terminal);
    const finals = stages.filter((stage) => stage.terminal);

    const edit = (next: FunnelStage[]) => {
        setSaved(false);
        setStages(next);
    };
    const updateStage = (key: string, patch: Partial<FunnelStage>) => edit(stages.map((stage) => (stage.key === key ? { ...stage, ...patch } : stage)));
    const moveOpen = (index: number, delta: number) => {
        const list = [...open];
        const [item] = list.splice(index, 1);
        list.splice(index + delta, 0, item!);
        edit([...list, ...finals]);
    };

    const row = (stage: FunnelStage, index: number | null) => (
        <li key={stage.key} className="grid gap-3 rounded-2xl border border-border bg-surface p-4 transition-shadow hover:shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
                <span
                    className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold",
                        stage.terminal === "won" ? "bg-success/15 text-success" : stage.terminal === "lost" ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
                    )}
                >
                    {stage.terminal === "won" ? <Trophy className="size-4" /> : stage.terminal === "lost" ? <XCircle className="size-4" /> : (index ?? 0) + 1}
                </span>
                <Input aria-label={t("process.stageName")} className="min-w-48 flex-1" value={stage.label} maxLength={40} onChange={(event) => updateStage(stage.key, { label: event.target.value })} />
                {stage.terminal ? (
                    <span className="text-[13px] text-muted-foreground">{t(`process.terminal.${stage.terminal}` as MessageKey)}</span>
                ) : (
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon" aria-label={`${t("process.up")}: ${stage.label}`} disabled={index === 0} onClick={() => moveOpen(index!, -1)}>
                            <ArrowUp className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`${t("process.down")}: ${stage.label}`} disabled={index === open.length - 1} onClick={() => moveOpen(index!, 1)}>
                            <ArrowDown className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`${t("process.removeStage")}: ${stage.label}`} disabled={open.length <= 1} onClick={() => edit(stages.filter((item) => item.key !== stage.key))}>
                            <Trash2 className="size-4" />
                        </Button>
                    </div>
                )}
            </div>
            <details className="group">
                <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground select-none hover:text-foreground">
                    {t("process.required")}
                    {(stage.requiredFields ?? []).length ? `: ${(stage.requiredFields ?? []).map((field) => t(`required.${field}`)).join(", ")}` : ""}
                </summary>
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
                    {REQUIRED.map((field) => (
                        <Checkbox
                            key={field}
                            label={t(`required.${field}`)}
                            checked={(stage.requiredFields ?? []).includes(field)}
                            onChange={(event) => {
                                const current = stage.requiredFields ?? [];
                                updateStage(stage.key, { requiredFields: event.target.checked ? [...current, field] : current.filter((item) => item !== field) });
                            }}
                        />
                    ))}
                </div>
            </details>
        </li>
    );

    return (
        <Form
            className="max-w-3xl"
            busy={action.busy}
            onSubmit={async () => {
                setSaved(false);
                if (await action.run(async () => api("/api/settings/process", { method: "PUT", body: { funnel: withTransitions(stages), employeesSeeBranch: seeBranch } }))) setSaved(true);
            }}
        >
            <Card className="grid gap-4 p-5">
                <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Flag className="size-5" />
                    </span>
                    <div>
                        <h2 className="text-[17px] font-bold">{t("process.funnel")}</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">{t("process.funnelHint")}</p>
                    </div>
                </div>
                <ol className="grid gap-2.5">
                    {open.map((stage, index) => row(stage, index))}
                    <li>
                        <Button
                            variant="secondary"
                            onClick={() => edit([...open, { key: newStageKey(), label: t("process.newStage"), requiredFields: [] }, ...finals])}
                        >
                            <Plus className="size-4" />
                            {t("process.addStage")}
                        </Button>
                    </li>
                    {finals.map((stage) => row(stage, null))}
                </ol>
            </Card>
            <Card className="grid gap-2 p-5">
                <h2 className="text-[17px] font-bold">{t("process.visibility")}</h2>
                <Checkbox
                    label={t("process.seeBranch")}
                    checked={seeBranch}
                    onChange={(event) => {
                        setSaved(false);
                        setSeeBranch(event.target.checked);
                    }}
                />
            </Card>
            {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            {saved ? <FormMessage kind="success">{t("process.saved")}</FormMessage> : null}
        </Form>
    );
}
