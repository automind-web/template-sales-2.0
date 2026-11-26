"use client";

import { Kanban } from "lucide-react";
import { StagePlaceholder } from "../../../components/coming-soon.tsx";
import { t } from "../../../i18n/index.ts";

export default function Page() {
    return <StagePlaceholder section="crm" title={t("nav.crm")} icon={Kanban} />;
}
