"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { t, type MessageKey } from "../i18n/index.ts";
import { api, errorMessage } from "../lib/api.ts";
import { cn } from "../lib/utils.ts";
import { BrandMark } from "./auth-layout.tsx";
import { useSession, type Section } from "./session.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/input.tsx";

const NAV: Array<{ section: Section; href: string; label: MessageKey }> = [
    { section: "training", href: "/training", label: "nav.training" },
    { section: "crm", href: "/crm", label: "nav.crm" },
    { section: "kpi", href: "/kpi", label: "nav.kpi" },
    { section: "stats", href: "/stats", label: "nav.stats" },
    { section: "whatsapp", href: "/whatsapp", label: "nav.whatsapp" },
    { section: "team", href: "/team", label: "nav.team" },
    { section: "branches", href: "/branches", label: "nav.branches" },
    { section: "settings", href: "/settings", label: "nav.settings" },
    { section: "profile", href: "/profile", label: "nav.profile" },
];

function BranchSwitcher() {
    const { me, selectBranch } = useSession();
    const [error, setError] = useState<string | null>(null);
    if (me.user.role !== "director") {
        return me.user.branchName ? (
            <span className="max-w-[45vw] truncate text-sm text-muted-foreground" title={me.user.branchName}>
                {t("common.branch")}: {me.user.branchName}
            </span>
        ) : null;
    }
    if (me.branches.length === 0) return null;
    return (
        <label className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{t("nav.branchSelect")}</span>
            <Select
                aria-label={t("nav.branchSelect")}
                className="w-auto max-w-[46vw] sm:max-w-56"
                value={me.selectedBranchId ?? "*"}
                disabled={me.branches.length === 1}
                onChange={(event) => {
                    setError(null);
                    selectBranch(event.target.value).catch((caught: unknown) => setError(errorMessage(caught)));
                }}
            >
                {me.branches.length > 1 && me.canSelectAllBranches ? <option value="*">{t("common.allBranches")}</option> : null}
                {me.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                        {branch.name}
                    </option>
                ))}
            </Select>
            {error ? (
                <span role="alert" className="text-xs text-danger">
                    {error}
                </span>
            ) : null}
        </label>
    );
}

export function AppShell({ children }: { children: ReactNode }) {
    const { me } = useSession();
    const pathname = usePathname() ?? "/";
    const [menuOpen, setMenuOpen] = useState(false);
    const items = NAV.filter((item) => me.sections[item.section]);

    async function logout() {
        try {
            await api("/api/auth/logout", { method: "POST" });
        } finally {
            window.location.assign("/login");
        }
    }

    const nav = (
        <nav aria-label={t("nav.menu")}>
            <ul className="grid gap-0.5">
                {items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                        <li key={item.href}>
                            <Link
                                href={item.href}
                                onClick={() => setMenuOpen(false)}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "flex items-center rounded-md px-2.5 py-1.5 text-sm",
                                    active ? "bg-selected font-medium text-selected-foreground" : "text-foreground hover:bg-muted"
                                )}
                            >
                                {t(item.label)}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );

    return (
        <div className="min-h-screen">
            <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
                {t("nav.skipToContent")}
            </a>
            <header className="sticky top-0 z-30 border-b border-border bg-surface">
                <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
                    <Button variant="ghost" size="icon" className="md:hidden" aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={t("nav.menu")} onClick={() => setMenuOpen((open) => !open)}>
                        ☰
                    </Button>
                    <Link href="/" className="flex min-w-0 items-center gap-2">
                        <BrandMark />
                        <span className="hidden truncate font-semibold sm:inline" title={me.company.name}>
                            {me.company.name}
                        </span>
                    </Link>
                    <div className="ml-auto flex min-w-0 items-center gap-2">
                        <BranchSwitcher />
                        <div className="hidden text-right leading-tight lg:block">
                            <div className="max-w-48 truncate text-sm font-medium" title={me.user.displayName}>
                                {me.user.displayName}
                            </div>
                            <div className="text-xs text-muted-foreground">{t(`role.${me.user.role}`)}</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => void logout()}>
                            {t("nav.logout")}
                        </Button>
                    </div>
                </div>
                {menuOpen ? (
                    <div id="mobile-nav" className="border-t border-border px-3 py-2 md:hidden">
                        <div className="mb-2 text-sm">
                            <div className="font-medium break-anywhere">{me.user.displayName}</div>
                            <div className="text-xs text-muted-foreground">{t(`role.${me.user.role}`)}</div>
                        </div>
                        {nav}
                    </div>
                ) : null}
            </header>
            <div className="flex">
                <aside className="sticky top-[49px] hidden h-[calc(100vh-49px)] w-52 shrink-0 overflow-y-auto border-r border-border bg-surface p-2 md:block">{nav}</aside>
                <main id="content" className="min-w-0 flex-1 p-3 sm:p-4">
                    {me.user.role === "employee" && !me.user.admitted ? (
                        <div role="status" className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                            {t("shell.notAdmitted")}
                        </div>
                    ) : null}
                    {children}
                </main>
            </div>
        </div>
    );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
                <h1 className="text-xl font-semibold break-anywhere">{title}</h1>
                {children}
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
    );
}

/** Раздел недоступен роли или до допуска: показываем причину, данные не запрашиваем */
export function SectionGate({ section, children }: { section: Section; children: ReactNode }) {
    const { me } = useSession();
    if (!me.sections[section]) {
        return (
            <div role="alert" className="rounded-md border border-border bg-surface px-4 py-6 text-sm">
                {t("shell.sectionLocked")}
            </div>
        );
    }
    return <>{children}</>;
}
