import type { ReactNode } from "react";
import { companyConfig } from "../config/company.ts";
import { Card } from "./ui/card.tsx";

export function BrandMark({ name = companyConfig.shortName }: { name?: string }) {
    if (companyConfig.logo) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={companyConfig.logo} alt="" className="h-8 w-auto" />;
    }
    return (
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">
            {name.slice(0, 3)}
        </span>
    );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
    return (
        <main className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center">
            <div className="w-full max-w-md">
                <div className="mb-4 flex items-center gap-2">
                    <BrandMark />
                    <span className="font-semibold break-anywhere">{companyConfig.name}</span>
                </div>
                <Card className="p-5">
                    <h1 className="text-lg font-semibold">{title}</h1>
                    {subtitle ? <div className="mt-1 text-sm text-muted-foreground break-anywhere">{subtitle}</div> : null}
                    <div className="mt-4">{children}</div>
                </Card>
            </div>
        </main>
    );
}
