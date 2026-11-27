import { BookOpen, ChartColumn, Kanban, MessageCircle, Target } from "lucide-react";
import type { ReactNode } from "react";
import { companyConfig } from "../config/company.ts";
import { t } from "../i18n/index.ts";
import { Card } from "./ui/card.tsx";

const MODULES = [
    { icon: BookOpen, label: "nav.training" },
    { icon: Kanban, label: "nav.crm" },
    { icon: Target, label: "nav.kpi" },
    { icon: ChartColumn, label: "nav.stats" },
    { icon: MessageCircle, label: "nav.whatsapp" },
] as const;

/** Страницы без входа: фирменная панель системы слева и форма справа (на телефоне — только форма) */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
    return (
        <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
                <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_60%_at_0%_0%,#ffffff2e,transparent_60%),radial-gradient(70%_60%_at_100%_100%,#00000033,transparent_60%)]" />
                <div aria-hidden className="absolute -right-24 -bottom-24 size-96 rounded-full border border-white/15" />
                <div aria-hidden className="absolute -right-8 -bottom-8 size-64 rounded-full border border-white/10" />
                <div className="relative flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-white/15 text-lg font-bold backdrop-blur">{(companyConfig.shortName.trim()[0] ?? "A").toUpperCase()}</span>
                    <span className="text-lg font-bold">{companyConfig.name}</span>
                </div>
                <div className="relative grid max-w-md gap-6">
                    <h2 className="text-4xl leading-tight font-bold tracking-tight">{t("auth.brandTitle")}</h2>
                    <p className="text-lg text-white/80">{t("auth.brandText")}</p>
                    <ul className="flex flex-wrap gap-2">
                        {MODULES.map(({ icon: Icon, label }, index) => (
                            <li key={label} className="rise-in inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-2 text-sm font-semibold backdrop-blur" style={{ "--i": index + 1 } as React.CSSProperties}>
                                <Icon className="size-4" />
                                {t(label)}
                            </li>
                        ))}
                    </ul>
                </div>
                <p className="relative text-sm text-white/60">{t("auth.brandFoot")}</p>
            </aside>
            <div className="flex items-start justify-center px-4 py-10 sm:items-center">
                <div className="page-in w-full max-w-md">
                    <div className="mb-6 flex items-center gap-2.5 lg:hidden">
                        <span className="grid size-10 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-md shadow-primary/25">{(companyConfig.shortName.trim()[0] ?? "A").toUpperCase()}</span>
                        <span className="font-bold">{companyConfig.name}</span>
                    </div>
                    <Card className="w-full p-7">
                        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                        {subtitle ? <div className="mt-2 text-sm leading-relaxed text-muted-foreground break-anywhere">{subtitle}</div> : null}
                        <div className="mt-5">{children}</div>
                    </Card>
                </div>
            </div>
        </main>
    );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <p className="mt-4 text-sm">
            <a className="font-medium text-primary hover:underline" href={href}>
                {children}
            </a>
        </p>
    );
}
