"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Page } from "../../../../components/app-shell.tsx";
import { SliceSummary } from "../../../../components/analytics/period.tsx";
import { stageLabel, stageTone, type Lead } from "../../../../components/crm/model.ts";
import { useSession } from "../../../../components/session.tsx";
import { StatusPill } from "../../../../components/ui/badge.tsx";
import { Card, EmptyState, Spinner } from "../../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../../components/ui/error-retry.tsx";
import { Table, Td, Th, THead } from "../../../../components/ui/table.tsx";
import type { FunnelConfig } from "../../../../config/company.ts";
import { formatMoney, formatShort, t, type MessageKey } from "../../../../i18n/index.ts";
import { api } from "../../../../lib/api.ts";
import { useApiData } from "../../../../lib/use-api.ts";

type Drill = { metric: string; total: number; period: { from: string; to: string }; branchName: string | null; funnel: FunnelConfig; leads: Lead[]; timezone: string };

/** Сделки, из которых рассчитан показатель. «Назад» возвращает тот же срез и сортировку. */
export default function StatsLeadsPage() {
    const { me } = useSession();
    const params = useSearchParams();
    const router = useRouter();
    const query = params?.toString() ?? "";
    const metric = params?.get("metric") ?? "";
    const from = params?.get("back") === "kpi" ? "kpi" : "stats";
    const data = useApiData(`drill-${query}`, (signal) => api<Drill>(`/api/stats/leads?${query}`, { signal }));

    const back = new URLSearchParams();
    for (const key of from === "kpi" ? ["from", "to", "userId", "tab"] : ["from", "to", "userId", "sort", "dir"]) {
        const value = params?.get(key);
        if (value) back.set(key, value);
    }
    const backHref = `/${from}?${back.toString()}`;
    const title = t(from === "kpi" ? "kpi.title" : "stats.title");
    const metricLabel = t(`metric.${metric}` as MessageKey);

    return (
        <Page title={title}>
            <div className="grid gap-4">
                <Link href={backHref} className="w-fit text-sm font-medium text-primary hover:underline">
                    {t(from === "kpi" ? "stats.backKpi" : "stats.back")}
                </Link>
                {data.error && !data.data ? (
                    <ErrorRetry message={data.error} onRetry={data.reload} />
                ) : !data.data ? (
                    <Spinner label={t("common.loading")} />
                ) : (
                    <>
                        <div>
                            <h2 className="text-xl font-bold">{t("stats.drillTitle", { metric: metricLabel })}</h2>
                            <p className="mt-1 text-sm font-semibold">{t("stats.drillTotal", { value: metric === "revenue_won" ? formatMoney(data.data.total) : data.data.total })}</p>
                        </div>
                        <SliceSummary period={data.data.period} branchName={data.data.branchName} userName={null} timezone={data.data.timezone} />
                        {data.data.leads.length === 0 ? (
                            <Card>
                                <EmptyState title={t("stats.noLeads")} />
                            </Card>
                        ) : (
                            <Table>
                                <THead>
                                    <tr>
                                        <Th className="w-16">{t("crm.colNumber")}</Th>
                                        <Th>{t("crm.colClient")}</Th>
                                        <Th>{t("crm.colOwner")}</Th>
                                        <Th className="text-right">{t("crm.colAmount")}</Th>
                                        <Th>{t("crm.colStage")}</Th>
                                        <Th>{t("crm.createdAt")}</Th>
                                    </tr>
                                </THead>
                                <tbody>
                                    {data.data.leads.map((lead) => {
                                        const funnel = data.data!.funnel;
                                        const index = funnel.stages.findIndex((stage) => stage.key === lead.stage);
                                        return (
                                            <tr key={lead.id} tabIndex={0} onClick={() => router.push(`/crm/${lead.id}`)} onKeyDown={(event) => event.key === "Enter" && router.push(`/crm/${lead.id}`)} className="cursor-pointer border-t border-border hover:bg-muted/60">
                                                <Td className="text-muted-foreground">#{lead.number}</Td>
                                                <Td className="min-w-48 font-bold break-anywhere">{lead.clientName}</Td>
                                                <Td className="break-anywhere">{lead.ownerName ?? t("crm.ownerNone")}</Td>
                                                <Td className="text-right whitespace-nowrap">{formatMoney(lead.amount)}</Td>
                                                <Td>
                                                    <StatusPill tone={stageTone(funnel.stages[index], index)}>{stageLabel(funnel, lead.stage)}</StatusPill>
                                                    {lead.closedAt ? <div className="mt-1 text-[13px] text-muted-foreground">{t("crm.closedAt", { date: formatShort(lead.closedAt, me.company.timezone) })}</div> : null}
                                                </Td>
                                                <Td className="text-[13px] whitespace-nowrap text-muted-foreground">{formatShort(lead.createdAt, me.company.timezone)}</Td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        )}
                    </>
                )}
            </div>
        </Page>
    );
}
