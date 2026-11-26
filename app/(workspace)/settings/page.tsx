"use client";

import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { BranchesSettings } from "../../../components/settings/branches.tsx";
import { CompanySettings } from "../../../components/settings/company.tsx";
import { ConnectionsSettings } from "../../../components/settings/connections.tsx";
import { InvitationsSettings } from "../../../components/settings/invitations.tsx";
import { MembersSettings } from "../../../components/settings/members.tsx";
import { Tabs, useTab, type TabItem } from "../../../components/ui/tabs.tsx";
import { t } from "../../../i18n/index.ts";

type TabKey = "company" | "branches" | "members" | "invitations" | "connections";

const DIRECTOR_TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "company", label: t("settings.tab.company") },
    { key: "branches", label: t("settings.tab.branches") },
    { key: "members", label: t("settings.tab.members") },
    { key: "invitations", label: t("settings.tab.invitations") },
    { key: "connections", label: t("settings.tab.connections") },
];

/** Руководитель филиала управляет только участниками и приглашениями своего филиала */
const MANAGER_TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "members", label: t("settings.tab.members") },
    { key: "invitations", label: t("settings.tab.invitations") },
];

export default function SettingsPage() {
    return (
        <SectionGate section="settings" title={t("settings.title")}>
            <Settings />
        </SectionGate>
    );
}

function Settings() {
    const { me } = useSession();
    const tabs = me.user.role === "director" ? DIRECTOR_TABS : MANAGER_TABS;
    const [tab, setTab] = useTab(tabs);
    return (
        <Page title={t("settings.title")}>
            <Tabs items={tabs} value={tab} onChange={setTab} label={t("settings.title")} />
            {tab === "company" ? <CompanySettings /> : null}
            {tab === "branches" ? <BranchesSettings /> : null}
            {tab === "members" ? <MembersSettings /> : null}
            {tab === "invitations" ? <InvitationsSettings /> : null}
            {tab === "connections" ? <ConnectionsSettings /> : null}
        </Page>
    );
}
