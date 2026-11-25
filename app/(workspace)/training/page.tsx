"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { MyCourses, useMyCourses } from "../../../components/training/my-courses.tsx";
import { AdmissionRulesEditor, Assignments, Catalog, TeamProgress } from "../../../components/training/staff.tsx";
import { FormMessage } from "../../../components/ui/field.tsx";
import { t, type MessageKey } from "../../../i18n/index.ts";
import { cn } from "../../../lib/utils.ts";

const STAFF_TABS = [
    { key: "team", label: "training.team" },
    { key: "catalog", label: "training.catalog" },
    { key: "assignments", label: "training.assignments" },
    { key: "rules", label: "training.rules" },
    { key: "mine", label: "training.myCourses" },
] as const satisfies ReadonlyArray<{ key: string; label: MessageKey }>;

type TabKey = (typeof STAFF_TABS)[number]["key"];

export default function TrainingPage() {
    return (
        <SectionGate section="training">
            <Training />
        </SectionGate>
    );
}

function Training() {
    const { me } = useSession();
    const staff = me.user.role !== "employee";
    const mine = useMyCourses();
    const params = useSearchParams();
    const router = useRouter();
    const pathname = usePathname() ?? "/training";
    const requested = params?.get("tab");
    const tab: TabKey = STAFF_TABS.some((item) => item.key === requested) ? (requested as TabKey) : "team";

    if (!staff) {
        return (
            <>
                <PageHeader title={t("training.title")} />
                <MyCourses data={mine} />
            </>
        );
    }

    const missing = mine.data?.admission.missingCourses ?? [];
    return (
        <>
            <PageHeader title={t("training.title")} />
            {missing.length > 0 ? (
                <div className="mb-3">
                    <FormMessage kind="info">{t("training.firstSetup", { course: missing.join(", ") })}</FormMessage>
                </div>
            ) : null}
            <div role="tablist" aria-label={t("training.title")} className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
                {STAFF_TABS.map((item) => (
                    <button
                        key={item.key}
                        role="tab"
                        type="button"
                        aria-selected={tab === item.key}
                        onClick={() => router.replace(`${pathname}?tab=${item.key}`, { scroll: false })}
                        className={cn("-mb-px shrink-0 border-b-2 px-3 py-1.5 text-sm whitespace-nowrap", tab === item.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                    >
                        {t(item.label)}
                    </button>
                ))}
            </div>
            {tab === "team" ? <TeamProgress /> : null}
            {tab === "catalog" ? <Catalog /> : null}
            {tab === "assignments" ? <Assignments /> : null}
            {tab === "rules" ? <AdmissionRulesEditor /> : null}
            {tab === "mine" ? <MyCourses data={mine} /> : null}
        </>
    );
}
