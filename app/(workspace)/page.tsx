"use client";

import { AlarmClock, ArrowRight, Bot, Briefcase, Check, CircleDollarSign, GraduationCap, MessageCircle, Plus, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FunnelConfig } from "../../config/company.ts";
import { Page } from "../../components/app-shell.tsx";
import { dueLabel, stageTone, type Lead } from "../../components/crm/model.ts";
import { useSession } from "../../components/session.tsx";
import { StatusPill } from "../../components/ui/badge.tsx";
import { buttonVariants } from "../../components/ui/button.tsx";
import { Card } from "../../components/ui/card.tsx";
import { ErrorRetry } from "../../components/ui/error-retry.tsx";
import { formatMoney, t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { cn } from "../../lib/utils.ts";

type Home = {
    gated: boolean;
    timezone: string;
    now: number;
    month: { values: Record<string, number> };
    today: { created: number; won: number };
    agenda: Lead[];
    recent: Lead[];
    unassigned: number;
    funnel: FunnelConfig;
    team: { employees: number; trained: number } | null;
    whatsapp: { agents: number; enabled: number; connected: number; chatsToday: number } | null;
    setup: { branches: number; people: number; agents: number } | null;
};

/** Плавный счётчик для чисел сводки (без анимации при reduce-motion) */
function useCountUp(target: number) {
    const [value, setValue] = useState(0);
    useEffect(() => {
        if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            const frame = requestAnimationFrame(() => setValue(target));
            return () => cancelAnimationFrame(frame);
        }
        const start = performance.now();
        let frame = 0;
        const tick = (time: number) => {
            const progress = Math.min(1, (time - start) / 700);
            setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target]);
    return value;
}

function Tile({ index, icon: Icon, label, value, hint, tone = "primary", href, money = false }: { index: number; icon: LucideIcon; label: string; value: number; hint: string; tone?: "primary" | "success" | "danger" | "warning"; href: string; money?: boolean }) {
    const shown = useCountUp(value);
    const tones = { primary: "bg-primary/10 text-primary", success: "bg-success/12 text-success", danger: "bg-danger/10 text-danger", warning: "bg-warning/15 text-warning" };
    return (
        <Link href={href} className="rise-in lift block rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_#1d24330a] sm:p-5" style={{ "--i": index } as React.CSSProperties}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground/70">{label}</span>
                <span className={cn("grid size-9 place-items-center rounded-xl", tones[tone])}>
                    <Icon className="size-[18px]" />
                </span>
            </div>
            <div className={cn("mt-2 text-[30px] leading-tight font-bold tracking-tight tabular-nums", tone === "danger" && value > 0 && "text-danger")}>{money ? formatMoney(shown) : shown}</div>
            <div className="mt-1 truncate text-[13px] text-muted-foreground">{hint}</div>
        </Link>
    );
}

function LeadRow({ lead, funnel, timezone, now }: { lead: Lead; funnel: FunnelConfig; timezone: string; now: number }) {
    const index = funnel.stages.findIndex((stage) => stage.key === lead.stage);
    const stage = funnel.stages[index];
    const due = dueLabel(lead, timezone, now);
    return (
        <li>
            <Link href={`/crm/${lead.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold", lead.source === "whatsapp" ? "bg-[#25d366]/15 text-[#128c4b]" : "bg-primary/10 text-primary")}>
                    {lead.source === "whatsapp" ? <MessageCircle className="size-4" /> : lead.clientName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{lead.clientName}</span>
                    <span className={cn("block truncate text-[13px]", due.tone === "danger" ? "text-danger" : due.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
                        #{lead.number} · {due.text}
                        {lead.source === "whatsapp" ? ` · ${t("home.whatsappLead")}` : ""}
                    </span>
                </span>
                <StatusPill tone={stageTone(stage, index)}>{stage?.label ?? lead.stage}</StatusPill>
            </Link>
        </li>
    );
}

function greeting(name: string, timezone: string, now: number) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
    const first = name.split(" ")[0] ?? name;
    return hour < 12 ? t("home.morning", { name: first }) : hour < 18 ? t("home.day", { name: first }) : t("home.evening", { name: first });
}

export default function HomePage() {
    const { me } = useSession();
    const router = useRouter();
    const gated = me.user.role === "employee" && !me.user.admitted;
    useEffect(() => {
        // Новый сотрудник до теста видит только обучение.
        if (gated) router.replace("/training");
    }, [gated, router]);
    const data = useApiData(`home-${me.selectedBranchId ?? ""}`, (signal) => (gated ? Promise.resolve(null) : api<Home>("/api/home", { signal })));
    if (gated) return null;
    return <Page title={t("nav.home")}>{data.error && !data.data ? <ErrorRetry message={data.error} onRetry={data.reload} /> : !data.data ? <HomeSkeleton /> : <Dashboard home={data.data} />}</Page>;
}

function HomeSkeleton() {
    return (
        <div className="grid gap-5" aria-busy="true" aria-label={t("common.loading")}>
            <div className="skeleton h-16 w-full max-w-md rounded-2xl" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="skeleton h-32 rounded-2xl" />
                ))}
            </div>
            <div className="skeleton h-72 rounded-2xl" />
        </div>
    );
}

function Dashboard({ home }: { home: Home }) {
    const { me } = useSession();
    const staff = me.user.role !== "employee";
    const values = home.month.values;
    const date = new Intl.DateTimeFormat("ru-RU", { timeZone: home.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(home.now));
    const setupSteps = home.setup
        ? [
              { done: home.setup.branches > 0, label: t("home.step.branch"), href: "/settings?tab=branches" },
              { done: home.setup.people > 1, label: t("home.step.people"), href: "/settings?tab=invitations" },
              { done: false, label: t("home.step.training"), href: "/training?tab=program" },
              { done: home.setup.agents > 0, label: t("home.step.whatsapp"), href: "/whatsapp" },
          ]
        : [];
    const showSetup = home.setup !== null && (home.setup.branches === 0 || home.setup.people <= 1 || home.setup.agents === 0);

    return (
        <div className="grid gap-5">
            <div className="rise-in flex flex-wrap items-end justify-between gap-3" style={{ "--i": 0 } as React.CSSProperties}>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-[28px]">{greeting(me.user.displayName, home.timezone, home.now)}</h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="first-letter:uppercase">{date}</span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="live-dot size-2 rounded-full bg-success" aria-hidden />
                            {t("home.live")}
                        </span>
                    </p>
                </div>
                <Link href="/crm" className={buttonVariants()}>
                    <Plus className="size-4" />
                    {t("home.newLead")}
                </Link>
            </div>

            {showSetup ? (
                <Card className="rise-in relative overflow-hidden p-0" style={{ "--i": 1 } as React.CSSProperties}>
                    <div className="absolute inset-0 bg-[radial-gradient(90%_140%_at_100%_0%,color-mix(in_oklab,var(--brand-primary)_14%,transparent),transparent_60%)]" aria-hidden />
                    <div className="relative grid gap-4 p-5 sm:p-6">
                        <div className="flex items-center gap-3">
                            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                                <Sparkles className="size-5" />
                            </span>
                            <div>
                                <h3 className="text-lg font-bold">{t("home.setup")}</h3>
                                <p className="text-sm text-muted-foreground">{t("home.setupText")}</p>
                            </div>
                        </div>
                        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {setupSteps.map((step, index) => (
                                <li key={step.label}>
                                    <Link href={step.href} className={cn("lift flex h-full items-center gap-3 rounded-xl border p-3", step.done ? "border-success/30 bg-success/5" : "border-border bg-surface")}>
                                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold", step.done ? "bg-success text-white" : "bg-primary/10 text-primary")}>{step.done ? <Check className="size-4" /> : index + 1}</span>
                                        <span className={cn("text-sm font-semibold", step.done && "text-muted-foreground line-through")}>{step.label}</span>
                                    </Link>
                                </li>
                            ))}
                        </ol>
                    </div>
                </Card>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile index={2} icon={Briefcase} label={t("home.tile.newToday")} value={home.today.created} hint={t("home.tile.newHint", { won: home.today.won })} href="/crm" />
                <Tile index={3} icon={TrendingUp} label={t("home.tile.open")} value={values["open_leads"] ?? 0} hint={t("home.tile.openHint")} href="/crm?view=kanban" tone="warning" />
                <Tile index={4} icon={AlarmClock} label={t("home.tile.overdue")} value={values["overdue_contacts"] ?? 0} hint={t("home.tile.overdueHint")} href="/crm?due=overdue" tone="danger" />
                <Tile index={5} icon={CircleDollarSign} label={t("home.tile.won")} value={values["leads_won"] ?? 0} hint={t("home.tile.wonHint", { sum: formatMoney(values["revenue_won"] ?? 0) })} href={staff ? "/stats" : "/kpi"} tone="success" />
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Card className="rise-in p-2 sm:p-3" style={{ "--i": 6 } as React.CSSProperties}>
                    <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
                        <h3 className="text-[17px] font-bold">{t("home.agenda")}</h3>
                        <Link href="/crm?due=today" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                            {t("home.agendaAll")}
                            <ArrowRight className="size-4" />
                        </Link>
                    </div>
                    {home.agenda.length ? (
                        <ul className="grid">
                            {home.agenda.map((lead) => (
                                <LeadRow key={lead.id} lead={lead} funnel={home.funnel} timezone={home.timezone} now={home.now} />
                            ))}
                        </ul>
                    ) : (
                        <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                            <Check className="size-4 text-success" />
                            {t("home.agendaEmpty")}
                        </p>
                    )}
                </Card>

                <div className="grid gap-5">
                    {home.team ? <TeamCard team={home.team} /> : null}
                    {home.whatsapp ? <WhatsAppCard wa={home.whatsapp} /> : null}
                    <Card className="rise-in p-2 sm:p-3" style={{ "--i": 9 } as React.CSSProperties}>
                        <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
                            <h3 className="text-[17px] font-bold">{t("home.recent")}</h3>
                            {home.unassigned > 0 ? <StatusPill tone="warning">{t("home.unassigned", { count: home.unassigned })}</StatusPill> : null}
                        </div>
                        {home.recent.length ? (
                            <ul className="grid">
                                {home.recent.map((lead) => (
                                    <LeadRow key={lead.id} lead={lead} funnel={home.funnel} timezone={home.timezone} now={home.now} />
                                ))}
                            </ul>
                        ) : (
                            <p className="px-3 py-6 text-sm text-muted-foreground">{t("home.recentEmpty")}</p>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}

function Ring({ percent }: { percent: number }) {
    const radius = 26;
    const length = 2 * Math.PI * radius;
    return (
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
            <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
            <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-primary transition-[stroke-dashoffset] duration-700" strokeDasharray={length} strokeDashoffset={length * (1 - percent / 100)} />
        </svg>
    );
}

function TeamCard({ team }: { team: { employees: number; trained: number } }) {
    const percent = team.employees ? Math.round((team.trained * 100) / team.employees) : 0;
    return (
        <Card className="rise-in flex items-center gap-4 p-5" style={{ "--i": 7 } as React.CSSProperties}>
            <div className="relative">
                <Ring percent={percent} />
                <GraduationCap className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="font-bold">{t("home.team")}</h3>
                <p className="text-sm text-muted-foreground">{team.employees ? t("home.teamText", { trained: team.trained, total: team.employees }) : t("home.teamEmpty")}</p>
            </div>
            <Link href="/training" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("home.teamOpen")}
            </Link>
        </Card>
    );
}

function WhatsAppCard({ wa }: { wa: { agents: number; enabled: number; connected: number; chatsToday: number } }) {
    const on = wa.enabled > 0;
    return (
        <Card className="rise-in relative overflow-hidden p-5" style={{ "--i": 8 } as React.CSSProperties}>
            <div className="flex items-start gap-4">
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", on ? "bg-[#25d366] text-white shadow-lg shadow-[#25d366]/30" : "bg-muted text-muted-foreground")}>
                    <Bot className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{t("home.wa")}</h3>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        {wa.agents ? (
                            <>
                                <span className={cn("size-2 rounded-full", on ? "live-dot bg-success" : "bg-muted-foreground/50")} aria-hidden />
                                {on ? t("home.waOn", { count: wa.chatsToday }) : t("home.waOff")}
                            </>
                        ) : (
                            t("home.waNone")
                        )}
                    </p>
                </div>
                <Link href="/whatsapp" className={buttonVariants({ variant: wa.agents ? "secondary" : "primary", size: "sm" })}>
                    {wa.agents ? t("home.waOpen") : t("home.waSetup")}
                </Link>
            </div>
        </Card>
    );
}
