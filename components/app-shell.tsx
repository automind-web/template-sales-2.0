"use client";

import { BookOpen, ChartColumn, ChevronDown, House, Kanban, Lock, Menu, MessageCircle, Settings, Target, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { companyConfig } from "../config/company.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { api, errorMessage } from "../lib/api.ts";
import { cn } from "../lib/utils.ts";
import { useSession, type Section } from "./session.tsx";
import { Card, EmptyState } from "./ui/card.tsx";
import { FormMessage } from "./ui/field.tsx";

type NavItem = { section: Section | "home"; href: string; label: MessageKey; icon: LucideIcon; lockable?: boolean };

/** Основные разделы — сверху; настройки и профиль — внизу, как в AI Management */
const MAIN_NAV: NavItem[] = [
    { section: "home", href: "/", label: "nav.home", icon: House },
    { section: "training", href: "/training", label: "nav.training", icon: BookOpen },
    { section: "crm", href: "/crm", label: "nav.crm", icon: Kanban, lockable: true },
    { section: "kpi", href: "/kpi", label: "nav.kpi", icon: Target, lockable: true },
    { section: "stats", href: "/stats", label: "nav.stats", icon: ChartColumn },
    { section: "whatsapp", href: "/whatsapp", label: "nav.whatsapp", icon: MessageCircle },
];
const BOTTOM_NAV: NavItem[] = [{ section: "settings", href: "/settings", label: "nav.settings", icon: Settings }];

type NavStatus = { overdue: number; whatsapp: "on" | "off" | null };
let navStatusCache: { at: number; scope: string; value: NavStatus } | null = null;

const ShellContext = createContext<{ openMenu: () => void }>({ openMenu: () => {} });

/** Квадрат с первой буквой компании (или логотип из настроек) */
export function CompanyMark({ name, className }: { name: string; className?: string }) {
    if (companyConfig.logo) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={companyConfig.logo} alt="" className={cn("size-9 shrink-0 rounded-lg object-contain", className)} />;
    }
    return (
        <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground", className)}>
            {(name.trim()[0] ?? "A").toUpperCase()}
        </span>
    );
}

function NavLink({ item, active, onNavigate, locked, badge }: { item: NavItem; active: boolean; onNavigate: () => void; locked?: boolean; badge?: ReactNode }) {
    const Icon = item.icon;
    if (locked) {
        return (
            <span aria-disabled="true" title={t("nav.lockedHint")} className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold text-foreground/40">
                <Icon aria-hidden className="size-[19px] shrink-0" strokeWidth={1.75} />
                <span className="flex-1 break-anywhere">{t(item.label)}</span>
                <Lock aria-hidden className="size-3.5" />
                <span className="sr-only">{t("nav.lockedHint")}</span>
            </span>
        );
    }
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-all duration-150",
                active ? "bg-surface text-foreground shadow-[0_1px_2px_#1d24330f,0_4px_14px_-8px_#1d243326]" : "text-foreground/75 hover:bg-muted hover:text-foreground"
            )}
        >
            {active ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary" /> : null}
            <Icon aria-hidden className={cn("size-[19px] shrink-0 transition-colors", active ? "text-primary" : "text-foreground/55 group-hover:text-foreground/80")} strokeWidth={1.75} />
            <span className="flex-1 break-anywhere">{t(item.label)}</span>
            {badge}
        </Link>
    );
}

function initials(name: string) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Sidebar({ onNavigate, closeSpace = false }: { onNavigate: () => void; closeSpace?: boolean }) {
    const { me } = useSession();
    const pathname = usePathname() ?? "/";
    const [status, setStatus] = useState<NavStatus | null>(() => navStatusCache?.value ?? null);
    const gated = me.user.role === "employee" && !me.user.admitted;
    useEffect(() => {
        if (gated) return;
        // Отметки меню обновляются не чаще раза в 20 секунд (и сразу при смене филиала), а не на каждом переходе.
        const scope = me.selectedBranchId ?? "";
        if (navStatusCache && navStatusCache.scope === scope && Date.now() - navStatusCache.at < 20_000) return;
        const controller = new AbortController();
        api<NavStatus>("/api/nav-status", { signal: controller.signal }).then((value) => {
            navStatusCache = { at: Date.now(), scope, value };
            setStatus(value);
        }, () => undefined);
        return () => controller.abort();
    }, [pathname, gated, me.selectedBranchId]);
    const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
    const visible = (item: NavItem) => (item.section === "home" ? !gated : me.sections[item.section] || (gated && item.lockable));
    const badgeFor = (item: NavItem): ReactNode => {
        if (item.section === "crm" && status && status.overdue > 0) {
            return (
                <span className="min-w-6 rounded-full bg-danger px-1.5 py-0.5 text-center text-[11px] leading-4 font-bold text-white" title={t("nav.overdue", { count: status.overdue })}>
                    {status.overdue > 99 ? "99+" : status.overdue}
                    <span className="sr-only">{t("nav.overdue", { count: status.overdue })}</span>
                </span>
            );
        }
        if (item.section === "whatsapp" && status?.whatsapp) {
            const on = status.whatsapp === "on";
            return (
                <span className={cn("size-2 rounded-full", on ? "live-dot bg-success" : "bg-foreground/25")} title={on ? t("nav.waOn") : t("nav.waOff")}>
                    <span className="sr-only">{on ? t("nav.waOn") : t("nav.waOff")}</span>
                </span>
            );
        }
        return null;
    };
    const profileActive = isActive("/profile");
    return (
        <div className="flex h-full flex-col gap-4 p-3">
            <Link href={gated ? "/training" : "/"} onClick={onNavigate} className={cn("flex min-w-0 items-center gap-2.5 px-1 pt-1", closeSpace && "pr-10")}>
                <CompanyMark name={me.company.name} className="shadow-md shadow-primary/25" />
                <span className="truncate text-[15px] font-bold" title={me.company.name}>
                    {me.company.name}
                </span>
            </Link>
            <nav aria-label={t("nav.menu")} className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-y-auto">
                <ul className="grid gap-1">
                    {MAIN_NAV.filter(visible).map((item) => (
                        <li key={item.href}>
                            <NavLink item={item} active={isActive(item.href)} onNavigate={onNavigate} locked={gated && item.lockable} badge={badgeFor(item)} />
                        </li>
                    ))}
                </ul>
                <ul className="grid gap-1">
                    {BOTTOM_NAV.filter(visible).map((item) => (
                        <li key={item.href}>
                            <NavLink item={item} active={isActive(item.href)} onNavigate={onNavigate} />
                        </li>
                    ))}
                    <li>
                        <Link
                            href="/profile"
                            onClick={onNavigate}
                            aria-current={profileActive ? "page" : undefined}
                            className={cn("flex items-center gap-3 rounded-xl border p-2.5 transition-all", profileActive ? "border-primary/30 bg-surface shadow-sm" : "border-transparent hover:bg-muted")}
                        >
                            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-[13px] font-bold text-primary-foreground">
                                {initials(me.user.displayName)}
                            </span>
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{me.user.displayName}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                    {t(`role.${me.user.role}` as MessageKey)}
                                    {me.user.branchName ? ` · ${me.user.branchName}` : ""}
                                </span>
                            </span>
                            <span className="sr-only">{t("nav.profile")}</span>
                        </Link>
                    </li>
                </ul>
            </nav>
        </div>
    );
}

export function AppShell({ children }: { children: ReactNode }) {
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menuOpen]);

    return (
        <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
            <div className="flex min-h-screen">
                <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
                    {t("nav.skipToContent")}
                </a>
                <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-background md:block">
                    <Sidebar onNavigate={() => {}} />
                </aside>
                {menuOpen ? (
                    <div className="fixed inset-0 z-40 md:hidden">
                        <div className="absolute inset-0 bg-[#1d2433]/45" onClick={() => setMenuOpen(false)} />
                        <aside id="mobile-nav" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-background shadow-2xl">
                            <button
                                type="button"
                                onClick={() => setMenuOpen(false)}
                                aria-label={t("common.close")}
                                className="absolute top-3 right-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-foreground/70 hover:bg-muted"
                            >
                                <X className="size-5" />
                            </button>
                            <Sidebar onNavigate={() => setMenuOpen(false)} closeSpace />
                        </aside>
                    </div>
                ) : null}
                <div id="content" className="flex min-w-0 flex-1 flex-col">
                    {children}
                </div>
            </div>
        </ShellContext.Provider>
    );
}

/** Выбор филиала: у директора — список, у остальных — название своего филиала */
function BranchSwitcher() {
    const { me, selectBranch } = useSession();
    const [error, setError] = useState<string | null>(null);
    if (me.user.role !== "director") {
        return me.user.branchName ? (
            <span className="max-w-[45vw] truncate text-sm font-semibold text-foreground/75" title={me.user.branchName}>
                {me.user.branchName}
            </span>
        ) : null;
    }
    if (me.branches.length === 0) return null;
    return (
        <div className="flex min-w-0 items-center gap-2">
            {error ? (
                <span role="alert" className="hidden text-xs text-danger sm:inline">
                    {error}
                </span>
            ) : null}
            <span className="relative inline-flex min-w-0">
                <select
                    aria-label={t("nav.branchSelect")}
                    className="control-h max-w-[46vw] cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface pr-9 pl-3.5 text-[15px] font-bold disabled:cursor-default sm:max-w-64"
                    value={me.selectedBranchId ?? "*"}
                    disabled={me.branches.length === 1}
                    onChange={(event) => {
                        setError(null);
                        selectBranch(event.target.value).catch((caught: unknown) => setError(errorMessage(caught)));
                    }}
                >
                    {me.branches.length > 1 ? <option value="*">{t("common.allBranches")}</option> : null}
                    {me.branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                            {branch.name}
                        </option>
                    ))}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
            </span>
        </div>
    );
}

/**
 * Страница рабочей области: шапка (заголовок слева, филиал справа) и содержимое.
 * Сотруднику без допуска здесь же показывается, что откроется после обучения.
 */
export function Page({ title, children, admissionBanner = true }: { title: string; children: ReactNode; admissionBanner?: boolean }) {
    const { me } = useSession();
    const { openMenu } = useContext(ShellContext);
    return (
        <>
            <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
                <button type="button" onClick={openMenu} aria-label={t("nav.menu")} aria-controls="mobile-nav" className="-ml-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg hover:bg-muted md:hidden">
                    <Menu className="size-5" />
                </button>
                <h1 className="min-w-0 truncate text-xl font-bold">{title}</h1>
                <div className="ml-auto flex min-w-0 items-center">
                    <BranchSwitcher />
                </div>
            </header>
            <main className="page-in w-full px-4 py-5 sm:px-6">
                {admissionBanner && me.user.role === "employee" && !me.user.admitted ? (
                    <div className="mb-4">
                        <FormMessage kind="info">{t("shell.notAdmitted")}</FormMessage>
                    </div>
                ) : null}
                {children}
            </main>
        </>
    );
}

/** Раздел недоступен роли или до допуска: показываем причину, данные не запрашиваем */
export function SectionGate({ section, title, children }: { section: Section; title: string; children: ReactNode }) {
    const { me } = useSession();
    if (!me.sections[section]) {
        return (
            <Page title={title}>
                <Card>
                    <EmptyState icon={Lock} title={t("shell.sectionLocked")} />
                </Card>
            </Page>
        );
    }
    return <>{children}</>;
}
