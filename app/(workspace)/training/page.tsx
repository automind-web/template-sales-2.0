"use client";

import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { MyCourses, useMyCourses } from "../../../components/training/my-courses.tsx";
import { AdmissionRulesEditor, Assignments, Catalog, TeamProgress } from "../../../components/training/staff.tsx";
import { FormMessage } from "../../../components/ui/field.tsx";
import { Tabs, useTab, type TabItem } from "../../../components/ui/tabs.tsx";
import { t } from "../../../i18n/index.ts";

type TabKey = "team" | "catalog" | "assignments" | "rules" | "mine";

const STAFF_TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "team", label: t("training.team") },
    { key: "catalog", label: t("training.catalog") },
    { key: "assignments", label: t("training.assignments") },
    { key: "rules", label: t("training.rules") },
    { key: "mine", label: t("training.myCourses") },
];

export default function TrainingPage() {
    return (
        <SectionGate section="training" title={t("training.title")}>
            <Training />
        </SectionGate>
    );
}

function Training() {
    const { me } = useSession();
    const mine = useMyCourses();
    // Сотруднику правила допуска показываются здесь же подробно, общая плашка не нужна.
    return <Page title={t("training.title")} admissionBanner={me.user.role !== "employee"}>{me.user.role === "employee" ? <MyCourses data={mine} /> : <StaffTraining mine={mine} />}</Page>;
}

function StaffTraining({ mine }: { mine: ReturnType<typeof useMyCourses> }) {
    const [tab, setTab] = useTab(STAFF_TABS);
    const missing = mine.data?.admission.missingCourses ?? [];
    return (
        <>
            {missing.length > 0 ? (
                <div className="mb-4">
                    <FormMessage kind="info">{t("training.firstSetup", { course: missing.join(", ") })}</FormMessage>
                </div>
            ) : null}
            <Tabs items={STAFF_TABS} value={tab} onChange={setTab} label={t("training.title")} />
            {tab === "team" ? <TeamProgress /> : null}
            {tab === "catalog" ? <Catalog /> : null}
            {tab === "assignments" ? <Assignments /> : null}
            {tab === "rules" ? <AdmissionRulesEditor /> : null}
            {tab === "mine" ? <MyCourses data={mine} /> : null}
        </>
    );
}
