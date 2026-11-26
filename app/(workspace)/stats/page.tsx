"use client";

import Link from "next/link";
import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { PeriodFilter, SliceSummary, useSlice } from "../../../components/analytics/period.tsx";
import { Card, Spinner } from "../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../components/ui/error-retry.tsx";
import { Table, Td, Th, THead, Tr } from "../../../components/ui/table.tsx";
import { formatMoney, t, type MessageKey } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { useApiData } from "../../../lib/use-api.ts";
import { cn } from "../../../lib/utils.ts";

type Ratio = { value: number | null; reason: string | null };
type Values = Record<string, number>;
type StatsResponse = {
    period: { from: string; to: string };
    timezone: string;
    branchName: string | null;
    userName: string | null;
    generatedAt: number;
    totals: { values: Values; conversion: Ratio; avgCheck: Ratio };
    employees: Array<{ userId: string; name: string; branchName: string | null; values: Values; conversion: Ratio; avgCheck: Ratio }>;
};

type Column = { key: string; label: MessageKey; metric?: string; kind: "count" | "money" | "ratio"; get: (row: { values: Values; conversion: Ratio; avgCheck: Ratio }) => number | null };

const COLUMNS: Column[] = [
    { key: "leads_created", label: "metric.leads_created", metric: "leads_created", kind: "count", get: (row) => row.values["leads_created"] ?? 0 },
    { key: "leads_won", label: "metric.leads_won", metric: "leads_won", kind: "count", get: (row) => row.values["leads_won"] ?? 0 },
    { key: "leads_lost", label: "metric.leads_lost", metric: "leads_lost", kind: "count", get: (row) => row.values["leads_lost"] ?? 0 },
    { key: "conversion", label: "stats.conversion", metric: "leads_closed", kind: "ratio", get: (row) => row.conversion.value },
    { key: "revenue_won", label: "metric.revenue_won", metric: "revenue_won", kind: "money", get: (row) => row.values["revenue_won"] ?? 0 },
    { key: "avg_check", label: "stats.avgCheck", metric: "leads_won", kind: "money", get: (row) => row.avgCheck.value },
    { key: "open_leads", label: "metric.open_leads", metric: "open_leads", kind: "count", get: (row) => row.values["open_leads"] ?? 0 },
    { key: "overdue_contacts", label: "metric.overdue_contacts", metric: "overdue_contacts", kind: "count", get: (row) => row.values["overdue_contacts"] ?? 0 },
];

export default function StatsPage() {
    return (
        <SectionGate section="stats" title={t("stats.title")}>
            <Stats />
        </SectionGate>
    );
}

function display(kind: Column["kind"], value: number | null): string {
    if (value === null) return "—";
    if (kind === "money") return formatMoney(Math.round(value));
    if (kind === "ratio") return `${Math.round(value * 100)}%`;
    return String(value);
}

function Stats() {
    const slice = useSlice();
    const sort = slice.params?.get("sort") ?? "overdue_contacts";
    const dir = slice.params?.get("dir") === "asc" ? "asc" : "desc";
    const data = useApiData(`stats-${slice.query}`, (signal) => api<StatsResponse>(`/api/stats?${slice.query}`, { signal }));

    /** Ссылка на исходные сделки: срез и сортировка уходят в адрес, чтобы вернуться к ним */
    const drill = (metric: string, owner?: string) => {
        const params = new URLSearchParams(slice.query);
        params.set("metric", metric);
        if (owner) params.set("owner", owner);
        params.set("sort", sort);
        params.set("dir", dir);
        return `/stats/leads?${params.toString()}`;
    };

    const column = COLUMNS.find((item) => item.key === sort) ?? COLUMNS[COLUMNS.length - 1]!;
    const rows = [...(data.data?.employees ?? [])].sort((a, b) => {
        const left = column.get(a) ?? -1;
        const right = column.get(b) ?? -1;
        return dir === "asc" ? left - right : right - left;
    });

    const totals = data.data?.totals;
    const tile = (label: MessageKey, value: string, caption: string, metric: string | null, danger = false) => {
        const body = (
            <>
                <div className="text-sm font-semibold text-foreground/80">{t(label)}</div>
                <div className={cn("mt-2 text-[26px] leading-tight font-bold whitespace-nowrap", danger && "text-danger")}>{value}</div>
                <div className="mt-1.5 text-[13px] text-muted-foreground">{caption}</div>
            </>
        );
        return (
            <Card key={label} className="p-0">
                {metric ? (
                    <Link href={drill(metric)} className="block h-full rounded-xl p-4 hover:bg-muted/50" aria-label={`${t(label)}: ${value}. ${t("kpi.openDeals")}`}>
                        {body}
                    </Link>
                ) : (
                    <div className="p-4">{body}</div>
                )}
            </Card>
        );
    };

    return (
        <Page title={t("stats.title")}>
            <div className="grid gap-4">
                <PeriodFilter slice={slice} showEmployee />
                {data.error && !data.data ? (
                    <ErrorRetry message={data.error} onRetry={data.reload} />
                ) : !data.data || !totals ? (
                    <Spinner label={t("common.loading")} />
                ) : (
                    <>
                        <SliceSummary period={data.data.period} branchName={data.data.branchName} userName={data.data.userName} timezone={data.data.timezone} generatedAt={data.data.generatedAt} />
                        <div aria-busy={data.loading} className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8", data.loading && "opacity-70")}>
                            {tile("metric.leads_created", String(totals.values["leads_created"]), t("metric.hint.leads_created"), "leads_created")}
                            {tile("metric.leads_won", String(totals.values["leads_won"]), t("metric.hint.leads_won"), "leads_won")}
                            {tile("metric.leads_lost", String(totals.values["leads_lost"]), t("metric.hint.leads_lost"), "leads_lost")}
                            {tile(
                                "stats.conversion",
                                display("ratio", totals.conversion.value),
                                totals.conversion.value === null ? t(`stats.reason.${totals.conversion.reason}` as MessageKey) : t("stats.conversionHint", { won: totals.values["leads_won"] ?? 0, closed: totals.values["leads_closed"] ?? 0 }),
                                "leads_closed"
                            )}
                            {tile("metric.revenue_won", formatMoney(totals.values["revenue_won"] ?? 0), t("metric.hint.revenue_won"), "revenue_won")}
                            {tile("stats.avgCheck", display("money", totals.avgCheck.value), totals.avgCheck.value === null ? t(`stats.reason.${totals.avgCheck.reason}` as MessageKey) : t("metric.hint.revenue_won"), "leads_won")}
                            {tile("metric.open_leads", String(totals.values["open_leads"]), t("metric.hint.open_leads"), "open_leads")}
                            {tile("metric.overdue_contacts", String(totals.values["overdue_contacts"]), t("metric.hint.overdue_contacts"), "overdue_contacts", (totals.values["overdue_contacts"] ?? 0) > 0)}
                        </div>
                        <h2 className="mt-2 text-xl font-bold">{t("stats.byEmployee")}</h2>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>{t("stats.employee")}</Th>
                                    {COLUMNS.map((item) => (
                                        <Th key={item.key} className="text-right" aria-sort={sort === item.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                                            <button
                                                type="button"
                                                onClick={() => slice.set({ sort: item.key, dir: sort === item.key && dir === "desc" ? "asc" : "desc" })}
                                                className="cursor-pointer uppercase hover:text-foreground"
                                            >
                                                {t(item.label)}
                                                {sort === item.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                                            </button>
                                        </Th>
                                    ))}
                                </tr>
                            </THead>
                            <tbody>
                                {rows.map((row) => (
                                    <Tr key={row.userId}>
                                        <Td className="min-w-48">
                                            <div className="font-bold break-anywhere">{row.userId === "none" ? t("stats.unassigned") : row.name}</div>
                                            {row.branchName && !data.data?.branchName ? <div className="text-[13px] text-muted-foreground">{row.branchName}</div> : null}
                                        </Td>
                                        {COLUMNS.map((item) => {
                                            const value = item.get(row);
                                            const text = display(item.kind, value);
                                            const reason = item.key === "conversion" ? row.conversion.reason : item.key === "avg_check" ? row.avgCheck.reason : null;
                                            return (
                                                <Td key={item.key} className="text-right whitespace-nowrap">
                                                    {value === null ? (
                                                        <span className="text-muted-foreground" title={reason ? t(`stats.reason.${reason}` as MessageKey) : undefined}>
                                                            —
                                                        </span>
                                                    ) : value === 0 || !item.metric ? (
                                                        <span>{text}</span>
                                                    ) : (
                                                        <Link href={drill(item.metric, row.userId)} className={cn("font-semibold text-primary hover:underline", item.key === "overdue_contacts" && "text-danger")}>
                                                            {text}
                                                        </Link>
                                                    )}
                                                </Td>
                                            );
                                        })}
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                        <p className="text-[13px] text-muted-foreground">{t("stats.footnote")}</p>
                    </>
                )}
            </div>
        </Page>
    );
}
