"use client";

import { Copy, Eye, GripVertical, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { formatShort, t, type MessageKey } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { cn } from "../../lib/utils.ts";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Input, Select } from "../ui/input.tsx";
import { Menu } from "../ui/menu.tsx";
import { ListCard, ListRow, Table, Td, Th, THead, Tr } from "../ui/table.tsx";
import { formatMoney } from "../../i18n/index.ts";

export type Token = { t: "field"; v: string } | { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "paren"; v: "(" | ")" };
export type Indicator = { key: string; title: string; unit: "count" | "money" | "percent"; plan: number | null; formula: Token[] };
type Version = { id: string; version: number; status: "draft" | "approved"; indicators: Indicator[]; createdAt: number; createdBy: string | null; approvedAt: number | null; approvedBy: string | null; effectiveFrom: number | null };
type Methodology = { scope: string; kind: "company" | "branch" | "user"; name: string | null; canEdit: boolean; fields: string[]; currentVersionId: string | null; currentScope: string | null; versions: Version[] };
type Person = { id: string; displayName: string; role: string; branchName: string | null; status: string };

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

    const peopleData = useApiData(`kpi-people-${me.user.role}`, (signal) =>
        api<{ users: Person[] }>(`/api/users?branchId=${me.user.role === "director" ? "*" : encodeURIComponent(me.user.branchId ?? "")}`, { signal }).then((result) => result.users.filter((user) => user.role !== "director" && user.status === "active"))
    );
    const people = peopleData.data ?? [];
    const groups = [
        ...(me.user.role === "director"
            ? [{ label: t("kpi.scopeGroup.company"), items: [{ id: "company", name: t("kpi.scopeCompany") }] }, { label: t("kpi.scopeGroup.branches"), items: me.branches.map((branch) => ({ id: branch.id, name: branch.name })) }]
            : [{ label: t("kpi.scopeGroup.branches"), items: [{ id: me.user.branchId ?? "company", name: me.user.branchName ?? "" }] }]),
        { label: t("kpi.scopeGroup.people"), items: people.map((person) => ({ id: `user:${person.id}`, name: person.branchName && me.user.role === "director" ? `${person.displayName} · ${person.branchName}` : person.displayName })) },
    ].filter((group) => group.items.length);

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
            <Field label={t("kpi.scopeLabel")} className="max-w-md">
                <Select
                    value={scope}
                    onChange={(event) => {
                        setNotice(null);
                        setScope(event.target.value);
                    }}
                >
                    {groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                            {group.items.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </Select>
            </Field>
            {data.data?.kind === "user" && data.data.name ? <FormMessage kind="info">{t("kpi.userFormula", { name: data.data.name })}</FormMessage> : null}
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
                                                    {version.effectiveFrom ? ` · ${t("kpi.effectiveFrom", { date: formatShort(version.effectiveFrom, me.company.timezone).split(",")[0]! })}` : ""}
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
                            people={people}
                            onSaved={() => {
                                setNotice(t("kpi.versionSaved"));
                                data.reload();
                            }}
                            onCopied={(count) => setNotice(t("kpi.copied", { count }))}
                        />
                    ) : null}
                </>
            )}
        </div>
    );
}

const emptyIndicator = (index: number): Indicator => ({ key: `kpi_${index}_${Math.random().toString(36).slice(2, 7)}`, title: "", unit: "count", plan: null, formula: [] });

type PreviewRow = { userId: string; name: string; branchName: string | null; indicators: Array<{ key: string; title: string; unit: Indicator["unit"]; plan: number | null; fact: number | null; percent: number | null }> };

function previewValue(unit: Indicator["unit"], value: number | null) {
    if (value === null) return "—";
    if (unit === "money") return formatMoney(Math.round(value));
    const rounded = Math.round(value * 100) / 100;
    return unit === "percent" ? `${rounded}%` : String(rounded);
}

function Editor({ scope, fields, base, people, onSaved, onCopied }: { scope: string; fields: string[]; base: Version | null; people: Person[]; onSaved: () => void; onCopied: (count: number) => void }) {
    const { me } = useSession();
    const [indicators, setIndicators] = useState<Indicator[]>(base?.indicators ?? [emptyIndicator(1)]);
    const [startDate, setStartDate] = useState("");
    const [preview, setPreview] = useState<PreviewRow[] | null>(null);
    const [copying, setCopying] = useState(false);
    const action = useAction();
    const previewAction = useAction();
    const update = (index: number, patch: Partial<Indicator>) => {
        setPreview(null);
        setIndicators((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    };
    const complete = indicators.length > 0 && indicators.every((item) => item.title.trim() && item.formula.length);

    return (
        <Card className="p-5">
            <Form
                submitLabel={t("kpi.saveVersion")}
                busy={action.busy}
                canSubmit={complete}
                onSubmit={async () => {
                    if (await action.run(async () => api("/api/kpi/methodology", { method: "POST", body: { scope, indicators, effectiveFrom: startDate || null } }))) onSaved();
                }}
                secondary={
                    <>
                        <Button variant="secondary" onClick={() => setIndicators((current) => [...current, emptyIndicator(current.length + 1)])}>
                            <Plus className="size-4" />
                            {t("kpi.newIndicator")}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={!complete || previewAction.busy}
                            onClick={() =>
                                void previewAction.run(async () => {
                                    const result = await api<{ rows: PreviewRow[] }>("/api/kpi/preview", { method: "POST", body: { scope, indicators } });
                                    setPreview(result.rows);
                                })
                            }
                        >
                            <Eye className="size-4" />
                            {t("kpi.preview")}
                        </Button>
                        {people.length ? (
                            <Button variant="secondary" disabled={!complete} onClick={() => setCopying(true)}>
                                <Copy className="size-4" />
                                {t("kpi.copy")}
                            </Button>
                        ) : null}
                    </>
                }
            >
                <Field label={t("kpi.startDate")} hint={t("kpi.startHint")} optional className="max-w-xs">
                    <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </Field>
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
                {previewAction.error ? <FormMessage kind="error">{previewAction.error}</FormMessage> : null}
                {preview ? <Preview rows={preview} /> : null}
            </Form>
            {copying ? (
                <CopyDialog
                    people={people}
                    indicators={indicators}
                    defaultDate={startDate}
                    timezoneLabel={me.company.timezone}
                    onClose={() => setCopying(false)}
                    onCopied={(count) => {
                        setCopying(false);
                        onCopied(count);
                    }}
                />
            ) : null}
        </Card>
    );
}

/** Предпросмотр: факт по формуле на экране, без сохранения */
function Preview({ rows }: { rows: PreviewRow[] }) {
    const columns = rows[0]?.indicators ?? [];
    return (
        <section aria-label={t("kpi.preview")} className="grid gap-2">
            <h3 className="font-bold">{t("kpi.preview")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("kpi.previewHint")}</p>
            {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("kpi.previewEmpty")}</p>
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <Th>{t("stats.employee")}</Th>
                            {columns.map((column) => (
                                <Th key={column.key}>{column.title}</Th>
                            ))}
                        </tr>
                    </THead>
                    <tbody>
                        {rows.map((row) => (
                            <Tr key={row.userId}>
                                <Td className="font-semibold">{row.name}</Td>
                                {row.indicators.map((indicator) => (
                                    <Td key={indicator.key} className="whitespace-nowrap">
                                        <strong>{previewValue(indicator.unit, indicator.fact)}</strong>
                                        {indicator.plan !== null ? <span className="text-muted-foreground"> / {previewValue(indicator.unit, indicator.plan)}</span> : null}
                                        {indicator.percent !== null ? <StatusPill tone={indicator.percent >= 100 ? "success" : indicator.percent >= 70 ? "warning" : "danger"} className="ml-2">{`${indicator.percent}%`}</StatusPill> : null}
                                    </Td>
                                ))}
                            </Tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </section>
    );
}

/** Копирование формулы на нескольких сотрудников с датой начала */
function CopyDialog({ people, indicators, defaultDate, onClose, onCopied }: { people: Person[]; indicators: Indicator[]; defaultDate: string; timezoneLabel: string; onClose: () => void; onCopied: (count: number) => void }) {
    const [selected, setSelected] = useState<string[]>([]);
    const [startDate, setStartDate] = useState(defaultDate);
    const action = useAction();
    const all = selected.length === people.length;
    return (
        <Dialog open onClose={onClose} title={t("kpi.copyTitle")} description={t("kpi.copyHint")}>
            <Form
                variant="dialog"
                submitLabel={t("kpi.copySubmit")}
                busy={action.busy}
                canSubmit={selected.length > 0}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    action.run(async () => {
                        const result = await api<{ copied: number }>("/api/kpi/methodology/copy", { method: "POST", body: { indicators, userIds: selected, effectiveFrom: startDate || null } });
                        onCopied(result.copied);
                    })
                }
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                <Field label={t("kpi.startDate")} hint={t("kpi.startHint")} optional>
                    <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </Field>
                <div className="grid gap-2">
                    <Checkbox label={t("kpi.copySelectAll")} checked={all} onChange={(event) => setSelected(event.target.checked ? people.map((person) => person.id) : [])} />
                    <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-border p-3">
                        {people.map((person) => (
                            <Checkbox
                                key={person.id}
                                label={person.branchName ? `${person.displayName} · ${person.branchName}` : person.displayName}
                                checked={selected.includes(person.id)}
                                onChange={(event) => setSelected((current) => (event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id)))}
                            />
                        ))}
                    </div>
                </div>
            </Form>
        </Dialog>
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
    // Перетаскивание мышью: блок встаёт на место того, над которым его отпустили.
    const dragFrom = useRef<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);
    const drop = (to: number) => {
        const from = dragFrom.current;
        dragFrom.current = null;
        setDragOver(null);
        if (from === null || from === to) return;
        const next = [...formula];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item!);
        onChange(next);
    };
    return (
        <div className="grid gap-2.5">
            <span className="text-[13px] font-semibold text-foreground/75">{t("kpi.formula")}</span>
            <span className="text-[12px] text-muted-foreground">{t("kpi.dragHint")}</span>
            <div aria-label={t("kpi.formula")} className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/50 p-2">
                {formula.length === 0 ? <span className="px-1 text-sm text-muted-foreground">{t("kpi.formulaEmpty")}</span> : null}
                {formula.map((token, index) => (
                    <span
                        key={index}
                        draggable
                        data-block-index={index}
                        onDragStart={(event) => {
                            dragFrom.current = index;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", String(index));
                        }}
                        onDragOver={(event) => {
                            if (dragFrom.current === null) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            if (dragOver !== index) setDragOver(index);
                        }}
                        onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                        onDrop={(event) => {
                            event.preventDefault();
                            drop(index);
                        }}
                        onDragEnd={() => {
                            dragFrom.current = null;
                            setDragOver(null);
                        }}
                        className={cn(
                            "inline-flex cursor-grab items-center gap-0.5 rounded-lg py-0.5 pr-0.5 pl-1 transition-shadow active:cursor-grabbing",
                            token.t === "field" ? "bg-selected text-sm font-semibold text-selected-foreground" : "border border-border bg-surface font-mono text-sm font-bold",
                            dragOver === index && "ring-2 ring-primary"
                        )}
                    >
                        <GripVertical aria-hidden className="size-3.5 opacity-40" />
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
