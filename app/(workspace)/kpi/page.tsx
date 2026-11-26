"use client";

import { Target } from "lucide-react";
import { StagePlaceholder } from "../../../components/coming-soon.tsx";
import { t } from "../../../i18n/index.ts";

export default function Page() {
    return <StagePlaceholder section="kpi" title={t("nav.kpi")} icon={Target} />;
}
