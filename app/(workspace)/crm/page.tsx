"use client";

import { PageHeader, SectionGate } from "../../../components/app-shell.tsx";
import { ComingSoon } from "../../../components/coming-soon.tsx";
import { t } from "../../../i18n/index.ts";

export default function Page() {
    return (
        <SectionGate section="crm">
            <PageHeader title={t("nav.crm")} />
            <ComingSoon section="crm" />
        </SectionGate>
    );
}
