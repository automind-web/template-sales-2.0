import type { ReactNode } from "react";
import { Card } from "./ui/card.tsx";

/** Страницы без входа: одна карточка по центру экрана */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
    return (
        <main className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center">
            <Card className="w-full max-w-md p-7 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
                <h1 className="text-2xl font-bold">{title}</h1>
                {subtitle ? <div className="mt-2 text-sm leading-relaxed text-muted-foreground break-anywhere">{subtitle}</div> : null}
                <div className="mt-5">{children}</div>
            </Card>
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
