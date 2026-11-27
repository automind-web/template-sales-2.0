"use client";

import { Page, SectionGate } from "../../../components/app-shell.tsx";
import Desk from "../../../components/wa-studio/desk.tsx";
import "../../../components/wa-studio/studio.css";
import { t } from "../../../i18n/index.ts";

/** WhatsApp Studio: агенты, база знаний, подключение номера и переписки (только директор) */
export default function WhatsAppPage() {
    return (
        <SectionGate section="whatsapp" title={t("wa.title")}>
            <Page title={t("wa.title")}>
                <div className="wa-studio">
                    <Desk />
                </div>
            </Page>
        </SectionGate>
    );
}
