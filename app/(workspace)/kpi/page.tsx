"use client";

import { Target } from "lucide-react";
import Link from "next/link";
import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { PeriodFilter, SliceSummary, useSlice } from "../../../components/analytics/period.tsx";
import { KpiBuilder } from "../../../components/kpi/builder.tsx";
import { useSession } from "../../../components/session.tsx";
import { ProgressBar } from "../../../components/training/progress-bar.tsx";
import { StatusPill } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Card, EmptyState, Spinner } from "../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../components/ui/error-retry.tsx";
import { Table, Td, Th, THead, Tr } from "../../../components/ui/table.tsx";
import { Tabs, useTab, type TabItem } from "../../../components/ui/tabs.tsx";
import { formatMoney, formatShort, t, type MessageKey } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { useApiData } from "../../../lib/use-api.ts";

type IndicatorResult = { key: string; title: string; unit: "count" | "money" | "percent"; plan: number | null; fact: number | null; reason: string | null; percent: number | null; fields: string[] };
type ReportRow = { userId: string; name: string; branchName: string | null; version: { version: number; scope: string; approvedAt: number | null } | null; indicators: IndicatorResult[] };
type Report = { period: { from: string; to: string }; timezone: string; branchName: string | null; self: boolean; configured: boolean; fields: string[]; rows: ReportRow[] };

type TabKey = "report" | "builder";
const TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "report", label: t("kpi.tab.report") },
    { key: "builder", label: t("kpi.tab.builder") },
];

export default function KpiPage() {
    return (
        <SectionGate section="kpi" title={t("kpi.title")}>
            <Kpi />
        </SectionGate>
    );
}

function Kpi() {
    const { me } = useSession();
    return <Page title={t("kpi.title")}>{me.user.role === "employee" ? <ReportView /> : <StaffKpi />}</Page>;
}

function StaffKpi() {
    const [tab, setTab] = useTab(TABS);
    return (
        <>
            <Tabs items={TABS} value={tab} onChange={setTab} label={t("kpi.title")} />
            {tab === "report" ? <ReportView onSetup={() => setTab("builder")} /> : <KpiBuilder />}
        </>
    );
}

function formatValue(unit: IndicatorResult["unit"], value: number | null): string {
    if (value === null) return "—";
    if (unit === "money") return formatMoney(Math.round(value));
    const rounded = Math.round(value * 100) / 100;
    return unit === "percent" ? `${rounded}%` : String(rounded);
}

function percentTone(percent: number | null) {
    if (percent === null) return "neutral" as const;
    return percent >= 100 ? ("success" as const) : percent >= 70 ? ("warning" as const) : ("danger" as const);
}

function ReportView({ onSetup }: { onSetup?: () => void }) {
    const { me } = useSession();
    const slice = useSlice();
    const staff = me.user.role !== "employee";
    const data = useApiData(`kpi-report-${slice.query}`, (signal) => api<Report>(`/api/kpi/report?${slice.query}`, { signal }));

    /** Исходные сделки показателя (если формула построена на одном поле) */
    const drill = (indicator: IndicatorResult, userId: string) => {
        if (indicator.fields.length !== 1) return null;
        const params = new URLSearchParams(slice.query);
        params.set("metric", indicator.fields[0]!);
        params.set("owner", userId);
        params.set("back", "kpi");
        return `/stats/leads?${params.toString()}`;
    };

    return (
        <div className="grid gap-4">
            <PeriodFilter slice={slice} showEmployee={staff} />
            {data.error && !data.data ? (
                <ErrorRetry message={data.error} onRetry={data.reload} />
            ) : !data.data ? (
                <Spinner label={t("common.loading")} />
            ) : !data.data.configured ? (
                <Card>
                    <EmptyState icon={Target} title={t("kpi.notConfiguredTitle")}>
                        {staff ? (
                            <div className="grid justify-items-center gap-3">
                                <p>{t("kpi.setupSteps")}</p>
                                <p>
                                    <strong className="text-foreground">{t("kpi.availableFields")}:</strong> {data.data.fields.map((field) => t(`metric.${field}` as MessageKey)).join(", ")}
                                </p>
                                {onSetup ? <Button onClick={onSetup}>{t("kpi.tab.builder")}</Button> : null}
                            </div>
                        ) : (
                            t("kpi.notConfiguredEmployee")
                        )}
                    </EmptyState>
                </Card>
            ) : (
                <>
                    <SliceSummary period={data.data.period} branchName={data.data.self ? (me.user.branchName ?? null) : data.data.branchName} userName={data.data.self ? me.user.displayName : null} timezone={data.data.timezone} />
                    {data.data.self ? <PersonalReport row={data.data.rows[0]!} timezone={data.data.timezone} drill={drill} /> : <TeamReport report={data.data} drill={drill} />}
                </>
            )}
        </div>
    );
}

function VersionLine({ row, timezone }: { row: ReportRow; timezone: string }) {
    if (!row.version) return null;
    return (
        <p className="text-[13px] text-muted-foreground">
            {t("kpi.version", { version: row.version.version, scope: row.version.scope === "company" ? t("kpi.scope.company") : t("kpi.scope.branch"), date: row.version.approvedAt ? formatShort(row.version.approvedAt, timezone) : "—" })}
        </p>
    );
}

/** Личный отчёт сотрудника: факт, план и выполнение подписаны, а не только окрашены */
function PersonalReport({ row, timezone, drill }: { row: ReportRow; timezone: string; drill: (indicator: IndicatorResult, userId: string) => string | null }) {
    return (
        <div className="grid gap-3">
            <h2 className="text-xl font-bold">{t("kpi.myReport")}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {row.indicators.map((indicator) => {
                    const href = drill(indicator, row.userId);
                    return (
                        <Card key={indicator.key} className="grid gap-3 p-5">
                            <div className="flex items-start justify-between gap-2">
                                <h3 className="text-[17px] font-bold break-anywhere">{indicator.title}</h3>
                                {indicator.percent !== null ? <StatusPill tone={percentTone(indicator.percent)}>{`${t("kpi.done")}: ${indicator.percent}%`}</StatusPill> : null}
                            </div>
                            <dl className="grid grid-cols-2 gap-3">
                                <div>
                                    <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("kpi.fact")}</dt>
                                    <dd className="mt-1 text-[28px] leading-tight font-bold">
                                        {href ? (
                                            <Link href={href} className="text-primary hover:underline">
                                                {formatValue(indicator.unit, indicator.fact)}
                                            </Link>
                                        ) : (
                                            formatValue(indicator.unit, indicator.fact)
                                        )}
                                    </dd>
                                    {indicator.reason ? <p className="text-[13px] text-muted-foreground">{t("kpi.divByZero")}</p> : null}
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("kpi.plan")}</dt>
                                    <dd className="mt-1 text-[28px] leading-tight font-bold text-foreground/60">{indicator.plan === null ? "—" : formatValue(indicator.unit, indicator.plan)}</dd>
                                    {indicator.plan === null ? <p className="text-[13px] text-muted-foreground">{t("kpi.noPlan")}</p> : null}
                                </div>
                            </dl>
                            {indicator.percent !== null ? <ProgressBar percent={indicator.percent} label={t("kpi.done")} /> : null}
                        </Card>
                    );
                })}
            </div>
            <VersionLine row={row} timezone={timezone} />
        </div>
    );
}

/** Отчёт руководителя: по каждому показателю — отдельно «Факт», «План» и «%» */
function TeamReport({ report, drill }: { report: Report; drill: (indicator: IndicatorResult, userId: string) => string | null }) {
    const columns: Array<{ key: string; title: string }> = [];
    for (const row of report.rows) for (const indicator of row.indicators) if (!columns.some((column) => column.key === indicator.key)) columns.push({ key: indicator.key, title: indicator.title });
    const versions = [...new Map(report.rows.filter((row) => row.version).map((row) => [`${row.version!.scope}-${row.version!.version}`, row])).values()];
    return (
        <div className="grid gap-3">
            <Table>
                <THead>
                    <tr>
                        <Th>{t("stats.employee")}</Th>
                        {columns.map((column) => (
                            <Th key={column.key} className="min-w-44">
                                {column.title}
                            </Th>
                        ))}
                    </tr>
                </THead>
                <tbody>
                    {report.rows.map((row) => (
                        <Tr key={row.userId}>
                            <Td className="min-w-48 align-top">
                                <div className="font-bold break-anywhere">{row.name}</div>
                                {row.branchName && !report.branchName ? <div className="text-[13px] text-muted-foreground">{row.branchName}</div> : null}
                            </Td>
                            {columns.map((column) => {
                                const indicator = row.indicators.find((item) => item.key === column.key);
                                if (!indicator) {
                                    return (
                                        <Td key={column.key} className="text-muted-foreground">
                                            —
                                        </Td>
                                    );
                                }
                                const href = drill(indicator, row.userId);
                                return (
                                    <Td key={column.key} className="align-top">
                                        <div className="grid gap-1 text-sm">
                                            <div>
                                                <span className="text-muted-foreground">{t("kpi.fact")}: </span>
                                                {href ? (
                                                    <Link href={href} className="font-bold text-primary hover:underline">
                                                        {formatValue(indicator.unit, indicator.fact)}
                                                    </Link>
                                                ) : (
                                                    <strong title={indicator.reason ? t("kpi.divByZero") : undefined}>{formatValue(indicator.unit, indicator.fact)}</strong>
                                                )}
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">{t("kpi.plan")}: </span>
                                                {indicator.plan === null ? <span className="text-muted-foreground">{t("kpi.noPlan")}</span> : formatValue(indicator.unit, indicator.plan)}
                                            </div>
                                            {indicator.percent !== null ? (
                                                <div>
                                                    <StatusPill tone={percentTone(indicator.percent)}>{`${indicator.percent}%`}</StatusPill>
                                                </div>
                                            ) : null}
                                        </div>
                                    </Td>
                                );
                            })}
                        </Tr>
                    ))}
                </tbody>
            </Table>
            {versions.map((row) => (
                <VersionLine key={`${row.version!.scope}-${row.version!.version}`} row={row} timezone={report.timezone} />
            ))}
        </div>
    );
}
