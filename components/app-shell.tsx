"use client";

import { BookOpen, ChartColumn, ChevronDown, Ellipsis, House, Kanban, Lock, MessageCircle, PanelLeftClose, PanelLeftOpen, Settings, Target, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { companyConfig } from "../config/company.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { api, errorMessage } from "../lib/api.ts";
import { blockedByDialog, hotkeyKeys, isTypingTarget, matchHotkey } from "../lib/hotkeys.ts";
import { cn } from "../lib/utils.ts";
import { useSession, type Section } from "./session.tsx";
import { Card, EmptyState } from "./ui/card.tsx";
import { Dialog } from "./ui/dialog.tsx";
import { FormMessage } from "./ui/field.tsx";

type NavItem = {
    section: Section | "home" | "profile";
    href: string;
    label: MessageKey;
    short?: MessageKey;
    icon: LucideIcon;
    lockable?: boolean;
};

/** Основные разделы — сверху; настройки и профиль — внизу, как в AI Management */
const MAIN_NAV: NavItem[] = [
    { section: "home", href: "/", label: "nav.home", icon: House },
    {
        section: "training",
        href: "/training",
        label: "nav.training",
        icon: BookOpen,
    },
    {
        section: "crm",
        href: "/crm",
        label: "nav.crm",
        icon: Kanban,
        lockable: true,
    },
    {
        section: "kpi",
        href: "/kpi",
        label: "nav.kpi",
        icon: Target,
        lockable: true,
    },
    {
        section: "stats",
        href: "/stats",
        label: "nav.stats",
        short: "nav.short.stats",
        icon: ChartColumn,
    },
    {
        section: "whatsapp",
        href: "/whatsapp",
        label: "nav.whatsapp",
        short: "nav.short.whatsapp",
        icon: MessageCircle,
    },
];
const SETTINGS_NAV: NavItem = {
    section: "settings",
    href: "/settings",
    label: "nav.settings",
    short: "nav.short.settings",
    icon: Settings,
};
const PROFILE_NAV: NavItem = {
    section: "profile",
    href: "/profile",
    label: "nav.profile",
    icon: UserRound,
};
/** Порядок вкладок нижней панели на телефоне: самые частые разделы первыми */
const TAB_PRIORITY: Array<NavItem["section"]> = ["home", "crm", "kpi", "stats", "training", "whatsapp"];
const MAX_TABS = 5;

type NavStatus = { overdue: number; whatsapp: "on" | "off" | null };
let navStatusCache: { at: number; scope: string; value: NavStatus } | null = null;

const ShellContext = createContext<{ toggleNav: () => void }>({
    toggleNav: () => {},
});

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

function initials(name: string) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Общие данные меню для боковой и нижней панели: что видно, что активно, отметки */
function useNav() {
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
        api<NavStatus>("/api/nav-status", { signal: controller.signal }).then(
            (value) => {
                navStatusCache = { at: Date.now(), scope, value };
                setStatus(value);
            },
            () => undefined,
        );
        return () => controller.abort();
    }, [pathname, gated, me.selectedBranchId]);
    const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
    const visible = (item: NavItem) => (item.section === "home" ? !gated : item.section === "profile" ? true : me.sections[item.section] || (gated && !!item.lockable));
    const locked = (item: NavItem) => gated && !!item.lockable;
    return { me, gated, status, isActive, visible, locked, pathname };
}
type Nav = ReturnType<typeof useNav>;

/** Отметка у пункта: число просроченных у CRM, точка работы агента у WhatsApp */
function NavBadge({ item, status, compact = false }: { item: NavItem; status: NavStatus | null; compact?: boolean }) {
    if (item.section === "crm" && status && status.overdue > 0) {
        return (
            <span
                className={cn(
                    "min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] leading-5 font-bold text-white tabular-nums",
                    compact
                        ? "absolute -top-1.5 left-[calc(50%+4px)] min-w-[18px] px-1 text-[10px] leading-[18px] ring-2 ring-surface"
                        : "nav-collapsed:absolute nav-collapsed:top-1 nav-collapsed:right-1.5 nav-collapsed:min-w-[18px] nav-collapsed:px-1 nav-collapsed:text-[10px] nav-collapsed:leading-[18px] nav-collapsed:ring-2 nav-collapsed:ring-background",
                )}
                title={t("nav.overdue", { count: status.overdue })}
            >
                {status.overdue > 99 ? "99+" : status.overdue}
                <span className="sr-only">{t("nav.overdue", { count: status.overdue })}</span>
            </span>
        );
    }
    if (item.section === "whatsapp" && status?.whatsapp) {
        const on = status.whatsapp === "on";
        return (
            <span
                className={cn(
                    "size-2 rounded-full",
                    on ? "live-dot bg-success" : "bg-foreground/25",
                    compact
                        ? "absolute top-0 left-[calc(50%+8px)] ring-2 ring-surface"
                        : "nav-collapsed:absolute nav-collapsed:top-2 nav-collapsed:right-3 nav-collapsed:ring-2 nav-collapsed:ring-background",
                )}
                title={on ? t("nav.waOn") : t("nav.waOff")}
            >
                <span className="sr-only">{on ? t("nav.waOn") : t("nav.waOff")}</span>
            </span>
        );
    }
    return null;
}

// --- Подсказка с названием пункта в свёрнутом меню ---

type Tip = { text: string; top: number; left: number } | null;
const collapsedNow = () => typeof document !== "undefined" && document.documentElement.dataset["nav"] === "collapsed";

function useTip() {
    const [tip, setTip] = useState<Tip>(null);
    const show = useCallback((event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, text: string) => {
        if (!collapsedNow()) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 10 });
    }, []);
    const hide = useCallback(() => setTip(null), []);
    const bind = (text: string) => ({
        onMouseEnter: (event: MouseEvent<HTMLElement>) => show(event, text),
        onMouseLeave: hide,
        onFocus: (event: FocusEvent<HTMLElement>) => show(event, text),
        onBlur: hide,
    });
    const node =
        tip && typeof document !== "undefined"
            ? createPortal(
                  <div
                      role="tooltip"
                      style={{ top: tip.top, left: tip.left }}
                      className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-background shadow-lg"
                  >
                      {tip.text}
                  </div>,
                  document.body,
              )
            : null;
    return { bind, hide, node };
}

function SideLink({ item, nav, tip }: { item: NavItem; nav: Nav; tip: ReturnType<typeof useTip> }) {
    const Icon = item.icon;
    const label = t(item.label);
    if (nav.locked(item)) {
        return (
            <span
                aria-disabled="true"
                tabIndex={0}
                {...tip.bind(`${label} · ${t("nav.lockedHint")}`)}
                title={t("nav.lockedHint")}
                className="relative flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold text-foreground/40 nav-collapsed:justify-center nav-collapsed:px-0"
            >
                <Icon aria-hidden className="size-[19px] shrink-0" strokeWidth={1.75} />
                <span className="flex-1 break-anywhere nav-collapsed:sr-only">{label}</span>
                <Lock aria-hidden className="size-3.5 nav-collapsed:absolute nav-collapsed:top-1.5 nav-collapsed:right-2.5 nav-collapsed:size-3" />
                <span className="sr-only">{t("nav.lockedHint")}</span>
            </span>
        );
    }
    const active = nav.isActive(item.href);
    return (
        <Link
            href={item.href}
            onClick={tip.hide}
            {...tip.bind(label)}
            aria-current={active ? "page" : undefined}
            className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-all duration-150 nav-collapsed:justify-center nav-collapsed:px-0",
                active ? "bg-surface text-foreground shadow-[0_1px_2px_#1d24330f,0_4px_14px_-8px_#1d243326]" : "text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
        >
            {active ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary" /> : null}
            <Icon aria-hidden className={cn("size-[19px] shrink-0 transition-colors", active ? "text-primary" : "text-foreground/55 group-hover:text-foreground/80")} strokeWidth={1.75} />
            <span className="flex-1 break-anywhere nav-collapsed:sr-only">{label}</span>
            <NavBadge item={item} status={nav.status} />
        </Link>
    );
}

/** Боковое меню на ПК; сворачивается до значков кнопкой или Ctrl+B (⌘+B) */
function Sidebar({ collapsed }: { collapsed: boolean }) {
    const nav = useNav();
    const { me } = nav;
    const { toggleNav } = useContext(ShellContext);
    const tip = useTip();
    const profileActive = nav.isActive("/profile");
    const toggleLabel = `${collapsed ? t("nav.expand") : t("nav.collapse")} (${hotkeyKeys("toggleNav")})`;
    return (
        <div className="flex h-full flex-col gap-4 p-3 nav-collapsed:px-2.5">
            <div className="flex items-center gap-2 px-1 pt-1 nav-collapsed:flex-col nav-collapsed:px-0">
                <Link href={nav.gated ? "/training" : "/"} {...tip.bind(me.company.name)} onClick={tip.hide} className="flex min-w-0 flex-1 items-center gap-2.5 nav-collapsed:flex-none">
                    <CompanyMark name={me.company.name} className="shadow-md shadow-primary/25" />
                    <span className="truncate text-[15px] font-bold nav-collapsed:sr-only" title={me.company.name}>
                        {me.company.name}
                    </span>
                </Link>
                <button
                    type="button"
                    onClick={() => {
                        tip.hide();
                        toggleNav();
                    }}
                    {...tip.bind(toggleLabel)}
                    aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
                    aria-expanded={!collapsed}
                    aria-controls="side-nav"
                    title={collapsed ? undefined : toggleLabel}
                    className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground/55 transition-colors hover:bg-muted hover:text-foreground"
                >
                    {collapsed ? <PanelLeftOpen aria-hidden className="size-[19px]" strokeWidth={1.75} /> : <PanelLeftClose aria-hidden className="size-[19px]" strokeWidth={1.75} />}
                </button>
            </div>
            <nav id="side-nav" aria-label={t("nav.menu")} className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-x-hidden overflow-y-auto">
                <ul className="grid gap-1">
                    {MAIN_NAV.filter(nav.visible).map((item) => (
                        <li key={item.href}>
                            <SideLink item={item} nav={nav} tip={tip} />
                        </li>
                    ))}
                </ul>
                <ul className="grid gap-1">
                    {nav.visible(SETTINGS_NAV) ? (
                        <li>
                            <SideLink item={SETTINGS_NAV} nav={nav} tip={tip} />
                        </li>
                    ) : null}
                    <li>
                        <Link
                            href="/profile"
                            onClick={tip.hide}
                            {...tip.bind(`${t("nav.profile")}: ${me.user.displayName}`)}
                            aria-current={profileActive ? "page" : undefined}
                            className={cn(
                                "flex items-center gap-3 rounded-xl border p-2.5 transition-all nav-collapsed:justify-center nav-collapsed:p-1.5",
                                profileActive ? "border-primary/30 bg-surface shadow-sm" : "border-transparent hover:bg-muted",
                            )}
                        >
                            <span
                                aria-hidden
                                className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-[13px] font-bold text-primary-foreground"
                            >
                                {initials(me.user.displayName)}
                            </span>
                            <span className="min-w-0 nav-collapsed:sr-only">
                                <span className="block truncate text-sm font-semibold">{me.user.displayName}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                    {me.user.workRoleName ?? t(`role.${me.user.role}` as MessageKey)}
                                    {me.user.branchName ? ` · ${me.user.branchName}` : ""}
                                </span>
                            </span>
                            <span className="sr-only">{t("nav.profile")}</span>
                        </Link>
                    </li>
                </ul>
            </nav>
            {tip.node}
        </div>
    );
}

/** Вкладка нижней панели: значок в «таблетке» и короткая подпись */
function TabButton({
    icon: Icon,
    label,
    active,
    locked,
    badge,
    ...rest
}: {
    icon: LucideIcon;
    label: string;
    active: boolean;
    locked?: boolean;
    badge?: ReactNode;
} & Record<string, unknown>) {
    const body = (
        <>
            <span className={cn("relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200", active ? "bg-primary/12 text-primary" : "text-foreground/60")}>
                <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2.1 : 1.8} />
                {locked ? <Lock aria-hidden className="absolute top-0 right-2.5 size-3 rounded-sm bg-surface" /> : null}
                {badge}
            </span>
            <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-4", active ? "font-bold text-primary" : "font-semibold text-foreground/70")}>{label}</span>
        </>
    );
    const cls = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 select-none [-webkit-tap-highlight-color:transparent]";
    if (locked) {
        return (
            <span aria-disabled="true" title={t("nav.lockedHint")} className={cn(cls, "opacity-45")}>
                {body}
                <span className="sr-only">{t("nav.lockedHint")}</span>
            </span>
        );
    }
    if (typeof rest["href"] === "string") {
        return (
            <Link href={rest["href"]} aria-current={active ? "page" : undefined} className={cn(cls, "active:scale-95 transition-transform")}>
                {body}
            </Link>
        );
    }
    return (
        <button
            type="button"
            onClick={rest["onClick"] as () => void}
            aria-haspopup="dialog"
            aria-expanded={rest["expanded"] as boolean}
            className={cn(cls, "cursor-pointer active:scale-95 transition-transform")}
        >
            {body}
        </button>
    );
}

/** Нижняя панель на телефоне: до 5 вкладок; если разделов больше — 4 вкладки и «Ещё» */
function TabBar() {
    const nav = useNav();
    const { me } = nav;
    // Лист «Ещё» открыт только на той странице, где его открыли: переход закрывает его сам.
    const [openedAt, setOpenedAt] = useState<string | null>(null);
    const moreOpen = openedAt === nav.pathname;
    const setMoreOpen = (open: boolean) => setOpenedAt(open ? nav.pathname : null);

    const priority = nav.gated ? (["training", ...TAB_PRIORITY.filter((s) => s !== "training")] as typeof TAB_PRIORITY) : TAB_PRIORITY;
    const main = priority.map((section) => MAIN_NAV.find((item) => item.section === section)!).filter(nav.visible);
    const all = [...main, ...(nav.visible(SETTINGS_NAV) ? [SETTINGS_NAV] : []), PROFILE_NAV];
    const tabs = all.length <= MAX_TABS ? all : all.slice(0, MAX_TABS - 1);
    const rest = all.length <= MAX_TABS ? [] : all.slice(MAX_TABS - 1);
    const moreActive = rest.some((item) => nav.isActive(item.href));
    const label = (item: NavItem) => t(item.short ?? item.label);

    return (
        <>
            <nav
                id="tab-bar"
                aria-label={t("nav.menu")}
                className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_#1d243340] backdrop-blur-md md:hidden"
            >
                <div className="mx-auto flex h-16 max-w-xl items-stretch px-1">
                    {tabs.map((item) => (
                        <TabButton
                            key={item.href}
                            href={item.href}
                            icon={item.icon}
                            label={label(item)}
                            active={nav.isActive(item.href)}
                            locked={nav.locked(item)}
                            badge={<NavBadge item={item} status={nav.status} compact />}
                        />
                    ))}
                    {rest.length ? (
                        <TabButton
                            icon={Ellipsis}
                            label={t("nav.more")}
                            active={moreActive || moreOpen}
                            expanded={moreOpen}
                            onClick={() => setMoreOpen(true)}
                            badge={
                                rest.some((item) => item.section === "crm" && (nav.status?.overdue ?? 0) > 0) ? (
                                    <span aria-hidden className="absolute top-0.5 right-3.5 size-2 rounded-full bg-danger ring-2 ring-surface" />
                                ) : null
                            }
                        />
                    ) : null}
                </div>
            </nav>
            <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t("nav.moreTitle")} className="sheet-up pb-[env(safe-area-inset-bottom)]">
                <div className="grid gap-4">
                    {rest.some((item) => item.section === "profile") ? (
                        <Link
                            href="/profile"
                            onClick={() => setMoreOpen(false)}
                            aria-current={nav.isActive("/profile") ? "page" : undefined}
                            className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 active:bg-muted"
                        >
                            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground">
                                {initials(me.user.displayName)}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-bold">{me.user.displayName}</span>
                                <span className="block truncate text-[13px] text-muted-foreground">
                                    {me.user.workRoleName ?? t(`role.${me.user.role}` as MessageKey)}
                                    {me.user.branchName ? ` · ${me.user.branchName}` : ""}
                                </span>
                            </span>
                            <span className="text-[13px] font-semibold text-primary">{t("nav.profile")}</span>
                        </Link>
                    ) : null}
                    <ul className="grid grid-cols-2 gap-2.5">
                        {rest
                            .filter((item) => item.section !== "profile")
                            .map((item) => {
                                const Icon = item.icon;
                                const active = nav.isActive(item.href);
                                const locked = nav.locked(item);
                                const inner = (
                                    <>
                                        <span className={cn("relative grid size-10 place-items-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                                            <Icon aria-hidden className="size-5" strokeWidth={1.9} />
                                            <NavBadge item={item} status={nav.status} compact />
                                        </span>
                                        <span className="text-[14px] leading-tight font-semibold break-anywhere">{t(item.label)}</span>
                                    </>
                                );
                                const cls = cn(
                                    "flex min-h-[92px] flex-col justify-between gap-3 rounded-2xl border p-3.5",
                                    active ? "border-primary/40 bg-primary/5" : "border-border bg-background active:bg-muted",
                                );
                                return (
                                    <li key={item.href}>
                                        {locked ? (
                                            <span aria-disabled="true" className={cn(cls, "opacity-45")}>
                                                {inner}
                                                <span className="text-xs text-muted-foreground">{t("nav.lockedHint")}</span>
                                            </span>
                                        ) : (
                                            <Link href={item.href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined} className={cls}>
                                                {inner}
                                            </Link>
                                        )}
                                    </li>
                                );
                            })}
                    </ul>
                </div>
            </Dialog>
        </>
    );
}

const NAV_KEY = "asc-nav";
const navListeners = new Set<() => void>();
function subscribeNav(listener: () => void) {
    navListeners.add(listener);
    return () => {
        navListeners.delete(listener);
    };
}

export function AppShell({ children }: { children: ReactNode }) {
    // Состояние уже выставлено на <html> скриптом до отрисовки; React читает его оттуда.
    const collapsed = useSyncExternalStore(subscribeNav, collapsedNow, () => false);

    const toggleNav = useCallback(() => {
        const next = !collapsedNow();
        if (next) document.documentElement.dataset["nav"] = "collapsed";
        else delete document.documentElement.dataset["nav"];
        try {
            localStorage.setItem(NAV_KEY, next ? "collapsed" : "open");
        } catch {
            // хранилище недоступно (приватный режим) — состояние живёт до перезагрузки
        }
        navListeners.forEach((listener) => listener());
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!matchHotkey("toggleNav", event) || isTypingTarget(event.target) || blockedByDialog(event.target)) return;
            if (!window.matchMedia("(min-width: 768px)").matches) return;
            event.preventDefault();
            toggleNav();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [toggleNav]);

    return (
        <ShellContext.Provider value={{ toggleNav }}>
            <div className="flex min-h-screen">
                <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
                    {t("nav.skipToContent")}
                </a>
                <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-background transition-[width] duration-200 ease-out md:block nav-collapsed:w-[76px] motion-reduce:transition-none">
                    <Sidebar collapsed={collapsed} />
                </aside>
                <div id="content" className="flex min-w-0 flex-1 flex-col pb-[var(--tabbar-h)] md:pb-0">
                    {children}
                </div>
                <TabBar />
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
    return (
        <>
            <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
                <Link href={me.user.role === "employee" && !me.user.admitted ? "/training" : "/"} aria-label={me.company.name} className="-ml-0.5 shrink-0 md:hidden">
                    <CompanyMark name={me.company.name} className="size-8 text-sm shadow-sm shadow-primary/25" />
                </Link>
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
