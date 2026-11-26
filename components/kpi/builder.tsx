"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { formatShort, t, type MessageKey } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";
import { Menu } from "../ui/menu.tsx";
import { ListCard, ListRow } from "../ui/table.tsx";

export type Token = { t: "field"; v: string } | { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "paren"; v: "(" | ")" };
export type Indicator = { key: string; title: string; unit: "count" | "money" | "percent"; plan: number | null; formula: Token[] };
type Version = { id: string; version: number; status: "draft" | "approved"; indicators: Indicator[]; createdAt: number; createdBy: string | null; approvedAt: number | null; approvedBy: string | null };
type Methodology = { scope: string; canEdit: boolean; fields: string[]; currentVersionId: string | null; currentScope: string | null; versions: Version[] };

const OP_SYMBOL: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };

export function tokenLabel(token: Token): string {
    if (token.t === "field") return t(`metric.${token.v}` as MessageKey);
    if (token.t === "num") return new Intl.NumberFormat("ru-RU").format(token.v);
    if (token.t === "op") return OP_SYMBOL[token.v]!;
    return token.v;
}

function tokenSpoken(token: Token): string {
    if (token.t === "op") return t(`kpi.op.${token.v}` as MessageKey);
    if (token.t === "paren") return t(`kpi.paren.${token.v}` as MessageKey);
    return tokenLabel(token);
}

/** Методика KPI: версии и редактор (каждое сохранение — новая версия) */
export function KpiBuilder() {
    const { me } = useSession();
    const defaultScope = me.user.role === "manager" ? (me.user.branchId ?? "company") : "company";
    const [scope, setScope] = useState(defaultScope);
    const data = useApiData(`kpi-methodology-${scope}`, (signal) => api<Methodology>(`/api/kpi/methodology?scope=${encodeURIComponent(scope)}`, { signal }));
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const scopes = me.user.role === "director" ? [{ id: "company", name: t("kpi.scopeCompany") }, ...me.branches.map((branch) => ({ id: branch.id, name: branch.name }))] : [{ id: me.user.branchId ?? "company", name: me.user.branchName ?? "" }];

    async function approve(id: string) {
        setError(null);
        try {
            await api(`/api/kpi/methodology/${id}/approve`, { method: "POST" });
            setNotice(t("kpi.approvedNotice"));
            data.reload();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }

    return (
        <div className="grid max-w-5xl gap-4">
            {scopes.length > 1 ? (
                <Field label={t("kpi.scopeLabel")} className="max-w-md">
                    <Select
                        value={scope}
                        onChange={(event) => {
                            setNotice(null);
                            setScope(event.target.value);
                        }}
                    >
                        {scopes.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </Select>
                </Field>
            ) : null}
            {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            {data.error && !data.data ? (
                <ErrorRetry message={data.error} onRetry={data.reload} />
            ) : !data.data ? (
                <Spinner label={t("common.loading")} />
            ) : (
                <>
                    {data.data.versions.length ? (
                        <div>
                            <h2 className="mb-2 text-[17px] font-bold">{t("kpi.versions")}</h2>
                            <ListCard>
                                {data.data.versions.map((version) => {
                                    const current = version.id === data.data!.currentVersionId;
                                    return (
                                        <ListRow key={version.id}>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-bold">{t("training.version", { version: version.version })}</span>
                                                    <StatusPill tone={current ? "success" : version.status === "approved" ? "info" : "neutral"}>{current ? t("kpi.current") : version.status === "approved" ? t("kpi.approved") : t("kpi.draft")}</StatusPill>
                                                </div>
                                                <div className="mt-0.5 text-[13px] text-muted-foreground break-anywhere">
                                                    {version.indicators.map((indicator) => indicator.title).join(" · ")}
                                                    {" · "}
                                                    {version.createdBy ?? ""} {formatShort(version.createdAt, me.company.timezone)}
                                                    {version.approvedAt ? ` · ${t("kpi.approved").toLowerCase()} ${formatShort(version.approvedAt, me.company.timezone)}` : ""}
                                                </div>
                                            </div>
                                            {version.status === "draft" && data.data!.canEdit ? <Button onClick={() => void approve(version.id)}>{t("kpi.approve")}</Button> : null}
                                        </ListRow>
                                    );
                                })}
                            </ListCard>
                        </div>
                    ) : null}
                    {data.data.canEdit ? (
                        <Editor
                            key={`${scope}-${data.data.versions[0]?.id ?? "new"}`}
                            scope={scope}
                            fields={data.data.fields}
                            base={data.data.versions[0] ?? null}
                            onSaved={() => {
                                setNotice(t("kpi.versionSaved"));
                                data.reload();
                            }}
                        />
                    ) : null}
                </>
            )}
        </div>
    );
}

const emptyIndicator = (index: number): Indicator => ({ key: `kpi_${index}_${Math.random().toString(36).slice(2, 7)}`, title: "", unit: "count", plan: null, formula: [] });

function Editor({ scope, fields, base, onSaved }: { scope: string; fields: string[]; base: Version | null; onSaved: () => void }) {
    const [indicators, setIndicators] = useState<Indicator[]>(base?.indicators ?? [emptyIndicator(1)]);
    const action = useAction();
    const update = (index: number, patch: Partial<Indicator>) => setIndicators((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

    return (
        <Card className="p-5">
            <Form
                submitLabel={t("kpi.saveVersion")}
                busy={action.busy}
                canSubmit={indicators.length > 0 && indicators.every((item) => item.title.trim() && item.formula.length)}
                onSubmit={async () => {
                    if (await action.run(async () => api("/api/kpi/methodology", { method: "POST", body: { scope, indicators } }))) onSaved();
                }}
                secondary={
                    <Button variant="secondary" onClick={() => setIndicators((current) => [...current, emptyIndicator(current.length + 1)])}>
                        <Plus className="size-4" />
                        {t("kpi.newIndicator")}
                    </Button>
                }
            >
                {base ? <p className="text-sm text-muted-foreground">{t("kpi.editingFrom", { version: base.version })}</p> : null}
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {indicators.map((indicator, index) => (
                    <fieldset key={indicator.key} className="grid gap-3 rounded-lg border border-border p-4">
                        <legend className="sr-only">{t("kpi.indicator", { index: index + 1 })}</legend>
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-bold">{t("kpi.indicator", { index: index + 1 })}</h3>
                            {indicators.length > 1 ? (
                                <Button variant="danger" size="sm" onClick={() => setIndicators((current) => current.filter((_, i) => i !== index))}>
                                    {t("kpi.removeIndicator")}
                                </Button>
                            ) : null}
                        </div>
                        <FieldGrid className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <Field label={t("kpi.indicatorTitle")}>
                                <Input value={indicator.title} maxLength={80} onChange={(event) => update(index, { title: event.target.value })} />
                            </Field>
                            <Field label={t("kpi.unit")}>
                                <Select value={indicator.unit} onChange={(event) => update(index, { unit: event.target.value as Indicator["unit"] })}>
                                    {(["count", "money", "percent"] as const).map((unit) => (
                                        <option key={unit} value={unit}>
                                            {t(`kpi.unit.${unit}`)}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={t("kpi.plan")} optional>
                                <Input inputMode="decimal" value={indicator.plan ?? ""} onChange={(event) => update(index, { plan: event.target.value === "" ? null : Number(event.target.value.replace(",", ".")) })} />
                            </Field>
                        </FieldGrid>
                        <FormulaEditor fields={fields} formula={indicator.formula} onChange={(formula) => update(index, { formula })} />
                    </fieldset>
                ))}
            </Form>
        </Card>
    );
}

/** Формула из блоков. Каждый блок — меню «…»: влево, вправо, удалить (касание и клавиатура). */
function FormulaEditor({ fields, formula, onChange }: { fields: string[]; formula: Token[]; onChange: (formula: Token[]) => void }) {
    const [field, setField] = useState(fields[0] ?? "");
    const [number, setNumber] = useState("");
    const add = (token: Token) => onChange([...formula, token]);
    const move = (index: number, delta: number) => {
        const next = [...formula];
        const [item] = next.splice(index, 1);
        next.splice(index + delta, 0, item!);
        onChange(next);
    };
    return (
        <div className="grid gap-2.5">
            <span className="text-[13px] font-semibold text-foreground/75">{t("kpi.formula")}</span>
            <div aria-label={t("kpi.formula")} className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/50 p-2">
                {formula.length === 0 ? <span className="px-1 text-sm text-muted-foreground">{t("kpi.formulaEmpty")}</span> : null}
                {formula.map((token, index) => (
                    <span
                        key={index}
                        className={
                            token.t === "field"
                                ? "inline-flex items-center gap-0.5 rounded-lg bg-selected py-0.5 pr-0.5 pl-2.5 text-sm font-semibold text-selected-foreground"
                                : "inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface py-0.5 pr-0.5 pl-2.5 font-mono text-sm font-bold"
                        }
                    >
                        {tokenLabel(token)}
                        <Menu
                            label={t("kpi.blockMenu", { label: tokenSpoken(token) })}
                            items={[
                                { label: t("kpi.moveLeft"), onSelect: () => move(index, -1), disabled: index === 0 },
                                { label: t("kpi.moveRight"), onSelect: () => move(index, 1), disabled: index === formula.length - 1 },
                                { label: t("kpi.removeBlock"), onSelect: () => onChange(formula.filter((_, i) => i !== index)), tone: "danger" },
                            ]}
                        />
                    </span>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select aria-label={t("kpi.addField")} className="w-auto min-w-52" value={field} onChange={(event) => setField(event.target.value)}>
                    {fields.map((item) => (
                        <option key={item} value={item}>
                            {t(`metric.${item}` as MessageKey)}
                        </option>
                    ))}
                </Select>
                <Button variant="secondary" onClick={() => field && add({ t: "field", v: field })}>
                    <Plus className="size-4" />
                    {t("kpi.addField")}
                </Button>
                {(["+", "-", "*", "/"] as const).map((op) => (
                    <Button key={op} variant="secondary" size="icon" aria-label={t(`kpi.op.${op}`)} onClick={() => add({ t: "op", v: op })} className="font-mono text-base">
                        {OP_SYMBOL[op]}
                    </Button>
                ))}
                {(["(", ")"] as const).map((paren) => (
                    <Button key={paren} variant="secondary" size="icon" aria-label={t(`kpi.paren.${paren}`)} onClick={() => add({ t: "paren", v: paren })} className="font-mono text-base">
                        {paren}
                    </Button>
                ))}
                <span className="flex items-center gap-1.5">
                    <Input aria-label={t("kpi.numberValue")} inputMode="decimal" className="w-24" value={number} onChange={(event) => setNumber(event.target.value)} />
                    <Button
                        variant="secondary"
                        disabled={number.trim() === "" || !Number.isFinite(Number(number.replace(",", ".")))}
                        onClick={() => {
                            add({ t: "num", v: Number(number.replace(",", ".")) });
                            setNumber("");
                        }}
                    >
                        {t("kpi.addNumber")}
                    </Button>
                </span>
            </div>
        </div>
    );
}
