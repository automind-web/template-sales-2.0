"use client";

import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { EmployeeProgram, ProgramEditor, TeamTraining } from "../../../components/training/program.tsx";
import { Tabs, useTab, type TabItem } from "../../../components/ui/tabs.tsx";
import { t } from "../../../i18n/index.ts";

type TabKey = "team" | "program";
const DIRECTOR_TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "team", label: t("prog.tab.team") },
    { key: "program", label: t("prog.tab.program") },
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
    if (me.user.role === "employee") {
        return (
            <Page title={t("training.title")} admissionBanner={false}>
                <EmployeeProgram />
            </Page>
        );
    }
    return <Page title={t("training.title")}>{me.user.role === "director" ? <DirectorTraining /> : <TeamTraining />}</Page>;
}

function DirectorTraining() {
    const [tab, setTab] = useTab(DIRECTOR_TABS);
    return (
        <>
            <Tabs items={DIRECTOR_TABS} value={tab} onChange={setTab} label={t("training.title")} />
            {tab === "team" ? <TeamTraining /> : <ProgramEditor />}
        </>
    );
}
