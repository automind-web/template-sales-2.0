import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { HydrationMark } from "../components/hydration-mark.tsx";
import { companyConfig } from "../config/company.ts";
import { t } from "../i18n/index.ts";
import "./globals.css";

export const metadata: Metadata = {
    title: companyConfig.name,
    description: t("meta.description", { company: companyConfig.name }),
    icons: { icon: "/favicon.svg" },
    robots: { index: false, follow: false },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: companyConfig.palette.primary,
};

function themeStyle(): CSSProperties {
    const { palette, fonts } = companyConfig;
    return {
        "--brand-background": palette.background,
        "--brand-foreground": palette.foreground,
        "--brand-surface": palette.surface,
        "--brand-muted": palette.muted,
        "--brand-muted-foreground": palette.mutedForeground,
        "--brand-border": palette.border,
        "--brand-primary": palette.primary,
        "--brand-primary-foreground": palette.primaryForeground,
        "--brand-danger": palette.danger,
        "--brand-danger-foreground": palette.dangerForeground,
        "--brand-success": palette.success,
        "--brand-warning": palette.warning,
        "--brand-selected": palette.selected,
        "--brand-selected-foreground": palette.selectedForeground,
        "--brand-focus": palette.focus,
        "--brand-font-sans": fonts.sans,
        "--brand-font-mono": fonts.mono,
    } as CSSProperties;
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang={companyConfig.locale} data-density={companyConfig.density} style={themeStyle()}>
            <body className="antialiased">
                <HydrationMark />
                {children}
            </body>
        </html>
    );
}
