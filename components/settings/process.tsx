"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import type { FunnelConfig } from "../../config/company.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { Tag } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Input, Select } from "../ui/input.tsx";

type ProcessData = { funnel: FunnelConfig; employeesSeeBranch: boolean; model: string; models: string[] };

const REQUIRED: Array<"amount" | "comment" | "nextContactAt" | "lostReason"> = ["nextContactAt", "amount", "lostReason", "comment"];

export function ProcessSettings() {
    const data = useApiData("process", (signal) => api<ProcessData>("/api/settings/process", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    return <ProcessForm initial={data.data} />;
}

function ProcessForm({ initial }: { initial: ProcessData }) {
    const [funnel, setFunnel] = useState(initial.funnel);
    const [seeBranch, setSeeBranch] = useState(initial.employeesSeeBranch);
    const [model, setModel] = useState(initial.model);
    const [saved, setSaved] = useState(false);
    const action = useAction();

    const edit = (next: FunnelConfig) => {
        setSaved(false);
        setFunnel(next);
    };
    const updateStage = (index: number, patch: Partial<FunnelConfig["stages"][number]>) => edit({ ...funnel, stages: funnel.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) });
    const moveStage = (index: number, delta: number) => {
        const stages = [...funnel.stages];
        const [item] = stages.splice(index, 1);
        stages.splice(index + delta, 0, item!);
        edit({ ...funnel, stages });
    };
    const toggleTransition = (from: string, to: string, on: boolean) => {
        const current = funnel.transitions[from] ?? [];
        edit({ ...funnel, transitions: { ...funnel.transitions, [from]: on ? [...current, to] : current.filter((key) => key !== to) } });
    };

    return (
        <Card className="max-w-5xl p-5">
            <Form
                busy={action.busy}
                onSubmit={async () => {
                    setSaved(false);
                    if (await action.run(async () => api("/api/settings/process", { method: "PUT", body: { funnel, employeesSeeBranch: seeBranch, model } }))) setSaved(true);
                }}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {saved ? <FormMessage kind="success">{t("process.saved")}</FormMessage> : null}
                <div>
                    <h2 className="text-[17px] font-bold">{t("process.funnel")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("process.funnelHint")}</p>
                </div>
                <ol className="grid gap-3">
                    {funnel.stages.map((stage, index) => (
                        <li key={stage.key} className="grid gap-3 rounded-lg border border-border p-3.5">
                            <div className="flex flex-wrap items-end gap-2">
                                <Field label={t("process.stageLabel", { key: stage.key })} className="min-w-48 flex-1">
                                    <Input value={stage.label} maxLength={40} onChange={(event) => updateStage(index, { label: event.target.value })} />
                                </Field>
                                {stage.terminal ? <Tag className="mb-2.5">{t(`process.terminal.${stage.terminal}` as MessageKey)}</Tag> : null}
                                <Button variant="secondary" size="icon" aria-label={`${t("process.up")}: ${stage.label}`} disabled={index === 0} onClick={() => moveStage(index, -1)}>
                                    <ArrowUp className="size-4" />
                                </Button>
                                <Button variant="secondary" size="icon" aria-label={`${t("process.down")}: ${stage.label}`} disabled={index === funnel.stages.length - 1} onClick={() => moveStage(index, 1)}>
                                    <ArrowDown className="size-4" />
                                </Button>
                            </div>
                            <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
                                <legend className="mb-1.5 text-[13px] font-semibold text-foreground/75">{t("process.required")}</legend>
                                {REQUIRED.map((field) => (
                                    <Checkbox
                                        key={field}
                                        label={t(`required.${field}`)}
                                        checked={(stage.requiredFields ?? []).includes(field)}
                                        onChange={(event) => {
                                            const current = stage.requiredFields ?? [];
                                            updateStage(index, { requiredFields: event.target.checked ? [...current, field] : current.filter((item) => item !== field) });
                                        }}
                                    />
                                ))}
                            </fieldset>
                            <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
                                <legend className="mb-1.5 text-[13px] font-semibold text-foreground/75">{t("process.transitions")}</legend>
                                {funnel.stages
                                    .filter((target) => target.key !== stage.key)
                                    .map((target) => (
                                        <Checkbox key={target.key} label={target.label} checked={(funnel.transitions[stage.key] ?? []).includes(target.key)} onChange={(event) => toggleTransition(stage.key, target.key, event.target.checked)} />
                                    ))}
                            </fieldset>
                        </li>
                    ))}
                </ol>
                <div className="grid gap-2">
                    <h2 className="text-[17px] font-bold">{t("process.visibility")}</h2>
                    <Checkbox
                        label={t("process.seeBranch")}
                        checked={seeBranch}
                        onChange={(event) => {
                            setSaved(false);
                            setSeeBranch(event.target.checked);
                        }}
                    />
                </div>
                <div className="grid gap-2">
                    <h2 className="text-[17px] font-bold">{t("process.assistant")}</h2>
                    <Field label={t("process.model")} className="max-w-md">
                        <Select
                            value={model}
                            onChange={(event) => {
                                setSaved(false);
                                setModel(event.target.value);
                            }}
                        >
                            {initial.models.map((item) => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </div>
            </Form>
        </Card>
    );
}
