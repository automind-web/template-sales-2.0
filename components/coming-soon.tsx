"use client";

import type { LucideIcon } from "lucide-react";
import { t } from "../i18n/index.ts";
import { api } from "../lib/api.ts";
import { useApiData } from "../lib/use-api.ts";
import { Page, SectionGate } from "./app-shell.tsx";
import type { Section } from "./session.tsx";
import { Card, EmptyState, Spinner } from "./ui/card.tsx";
import { ErrorRetry } from "./ui/error-retry.tsx";

/** Раздел следующего этапа. Доступ к нему всё равно подтверждается сервером. */
export function StagePlaceholder({ section, title, icon }: { section: Section; title: string; icon: LucideIcon }) {
    return (
        <SectionGate section={section} title={title}>
            <Page title={title}>
                <Check section={section} icon={icon} />
            </Page>
        </SectionGate>
    );
}

function Check({ section, icon }: { section: Section; icon: LucideIcon }) {
    const access = useApiData(`section-${section}`, (signal) => api(`/api/sections/${section}`, { signal }));
    if (access.error) return <ErrorRetry message={access.error} onRetry={access.reload} />;
    if (!access.data) return <Spinner label={t("common.loading")} />;
    return (
        <Card>
            <EmptyState icon={icon} title={t("shell.comingSoonTitle")}>
                {t("shell.comingSoon")}
            </EmptyState>
        </Card>
    );
}
