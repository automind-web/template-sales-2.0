"use client";

import { ChartColumn } from "lucide-react";
import { StagePlaceholder } from "../../../components/coming-soon.tsx";
import { t } from "../../../i18n/index.ts";

export default function Page() {
    return <StagePlaceholder section="stats" title={t("nav.stats")} icon={ChartColumn} />;
}
