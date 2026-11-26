"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatShort, t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { addDays, currentMonth, formatLocalDate, localDateOf, type LocalDate } from "../../lib/time.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { Chip } from "../ui/badge.tsx";
import { Input, Select } from "../ui/input.tsx";

/** Быстрые периоды в часовом поясе компании */
export function presets(timezone: string, now: number) {
    const today = localDateOf(timezone, now);
    const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7; // пн = 0
    const month = currentMonth(timezone, now);
    const lastMonthEnd = addDays(month.from, -1);
    const lastMonthStart: LocalDate = { ...lastMonthEnd, day: 1 };
    return [
        { key: "week", label: t("stats.thisWeek"), from: addDays(today, -weekday), to: addDays(today, 6 - weekday) },
        { key: "month", label: t("stats.thisMonth"), from: month.from, to: month.to },
        { key: "lastMonth", label: t("stats.lastMonth"), from: lastMonthStart, to: lastMonthEnd },
        { key: "days30", label: t("stats.days30"), from: addDays(today, -29), to: today },
    ].map((preset) => ({ ...preset, from: formatLocalDate(preset.from), to: formatLocalDate(preset.to) }));
}

/** Срез из адреса: период, сотрудник, сортировка. Без параметров — текущий месяц. */
export function useSlice() {
    const { me } = useSession();
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname() ?? "/";
    const [now] = useState(() => Date.now());
    const month = currentMonth(me.company.timezone, now);
    const from = params?.get("from") ?? formatLocalDate(month.from);
    const to = params?.get("to") ?? formatLocalDate(month.to);
    const userId = params?.get("userId") ?? "";
    const queryRef = useRef(params?.toString() ?? "");
    useEffect(() => {
        queryRef.current = params?.toString() ?? "";
    }, [params]);
    function set(patch: Record<string, string | null>) {
        const next = new URLSearchParams(queryRef.current);
        for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        queryRef.current = next.toString();
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
    const branchId = me.user.role === "director" ? (me.selectedBranchId ?? "*") : (me.user.branchId ?? "");
    /** Параметры запроса к серверу (одинаковы для отчёта и перехода к сделкам) */
    const query = new URLSearchParams({ from, to, ...(branchId ? { branchId } : {}), ...(userId ? { userId } : {}) }).toString();
    return { from, to, userId, branchId, query, params, set };
}

export function PeriodFilter({ slice, showEmployee }: { slice: ReturnType<typeof useSlice>; showEmployee: boolean }) {
    const { me } = useSession();
    const [now] = useState(() => Date.now());
    const list = presets(me.company.timezone, now);
    const people = useApiData(`slice-users-${slice.branchId}`, (signal) =>
        showEmployee ? api<{ users: Array<{ id: string; displayName: string; role: string }> }>(`/api/users?branchId=${encodeURIComponent(slice.branchId)}`, { signal }) : Promise.resolve({ users: [] })
    );
    return (
        <div className="flex flex-wrap items-center gap-2">
            {list.map((preset) => (
                <Chip key={preset.key} selected={slice.from === preset.from && slice.to === preset.to} onClick={() => slice.set({ from: preset.from, to: preset.to })}>
                    {preset.label}
                </Chip>
            ))}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {t("stats.from")}
                <Input type="date" aria-label={`${t("kpi.period")}: ${t("stats.from")}`} className="w-auto" value={slice.from} onChange={(event) => event.target.value && slice.set({ from: event.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {t("stats.to")}
                <Input type="date" aria-label={`${t("kpi.period")}: ${t("stats.to")}`} className="w-auto" value={slice.to} onChange={(event) => event.target.value && slice.set({ to: event.target.value })} />
            </label>
            {showEmployee ? (
                <Select aria-label={t("stats.employee")} className="w-auto min-w-52" value={slice.userId} onChange={(event) => slice.set({ userId: event.target.value || null })}>
                    <option value="">{t("stats.allEmployees")}</option>
                    {(people.data?.users ?? [])
                        .filter((user) => user.role !== "director")
                        .map((user) => (
                            <option key={user.id} value={user.id}>
                                {user.displayName}
                            </option>
                        ))}
                </Select>
            ) : null}
        </div>
    );
}

function formatDay(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** Строка среза: что именно посчитано (как в макете) */
export function SliceSummary({ period, branchName, userName, timezone, generatedAt }: { period: { from: string; to: string }; branchName: string | null; userName: string | null; timezone: string; generatedAt?: number }) {
    const items: Array<[string, string]> = [
        [t("stats.summary.period"), `${formatDay(period.from)} — ${formatDay(period.to)}`],
        [t("stats.summary.branch"), branchName ?? t("common.allBranches")],
        [t("stats.summary.employee"), userName ?? t("stats.allEmployees")],
        [t("stats.summary.timezone"), timezone],
    ];
    if (generatedAt) items.push([t("stats.summary.slice"), formatShort(generatedAt, timezone)]);
    return (
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {items.map(([label, value]) => (
                <span key={label}>
                    {label}: <strong className="font-semibold text-foreground">{value}</strong>
                </span>
            ))}
        </p>
    );
}
