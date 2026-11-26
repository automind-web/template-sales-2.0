"use client";

import { MessageCircle } from "lucide-react";
import { StagePlaceholder } from "../../../components/coming-soon.tsx";
import { t } from "../../../i18n/index.ts";

export default function Page() {
    return <StagePlaceholder section="whatsapp" title={t("nav.whatsapp")} icon={MessageCircle} />;
}
