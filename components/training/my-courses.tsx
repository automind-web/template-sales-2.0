"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { buttonVariants } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { FormMessage } from "../ui/field.tsx";
import { ProgressBar } from "./progress-bar.tsx";
import type { CourseSummary, MyCourses as MyCoursesData, RuleStatus } from "./types.ts";

export function useMyCourses() {
    return useApiData("training-my", (signal) => api<MyCoursesData>("/api/training/courses", { signal }));
}

export function AdmissionRulesStatus({ rules }: { rules: RuleStatus[] }) {
    return (
        <ul className="mt-2 grid gap-1.5">
            {rules.map((rule) => (
                <li key={rule.courseKey} className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={rule.satisfied ? "success" : "warning"}>{rule.satisfied ? t("training.passed") : t("training.notPassed")}</StatusPill>
                    <span className="break-anywhere">
                        {rule.courseAvailable
                            ? t("training.ruleLine", { course: rule.courseKey, min: rule.minScorePercent, best: rule.bestPercent === null ? t("common.none") : `${rule.bestPercent}%` })
                            : t("training.ruleMissingCourse", { course: rule.courseKey })}
                    </span>
                </li>
            ))}
        </ul>
    );
}

/** Статус курса одной меткой: начат, сдан, не сдан или не начат */
export function CourseStatus({ inProgress, bestPercent, passed }: { inProgress: boolean; bestPercent: number | null; passed: boolean }) {
    if (inProgress) return <StatusPill tone="info">{t("training.inProgress")}</StatusPill>;
    if (bestPercent === null) return <StatusPill>{t("training.noAttempts")}</StatusPill>;
    return <StatusPill tone={passed ? "success" : "danger"}>{passed ? t("training.passed") : t("training.notPassed")}</StatusPill>;
}

function CourseCard({ course }: { course: CourseSummary }) {
    const testLabel = course.openAttempt ? t("training.continueTest") : course.attempts > 0 ? t("training.retakeTest") : t("training.startTest");
    return (
        <Card className="grid content-start gap-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-[17px] font-bold break-anywhere">
                        <Link href={`/training/${course.id}`} className="hover:underline">
                            {course.title}
                        </Link>
                    </h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {t("training.version", { version: course.version })} · {t("training.questions", { count: course.questions })}
                        {course.requiredForAdmission ? ` · ${t("training.requiredForAdmission")}` : ""}
                    </p>
                </div>
                <CourseStatus inProgress={Boolean(course.openAttempt)} bestPercent={course.bestPercent} passed={course.passed} />
            </div>
            {course.description ? <p className="text-sm text-muted-foreground break-anywhere">{course.description}</p> : null}
            <ProgressBar percent={course.lessons.percent} label={t("training.lessonsProgress", { done: course.lessons.completed, total: course.lessons.total })} />
            <p className="text-[13px] text-muted-foreground">
                {t("training.minScore", { percent: course.minScorePercent })}
                {course.bestPercent === null ? "" : ` · ${t("training.bestScore", { percent: course.bestPercent })}`}
            </p>
            <div className="flex flex-wrap gap-2">
                <Link href={`/training/${course.id}/test`} className={buttonVariants({ variant: "primary" })}>
                    {testLabel}
                </Link>
                <Link href={`/training/${course.id}`} className={buttonVariants({ variant: "secondary" })}>
                    {t("training.openCourse")}
                </Link>
            </div>
        </Card>
    );
}

export function MyCourses({ data }: { data: ReturnType<typeof useMyCourses> }) {
    const { me } = useSession();
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    const { courses, admission } = data.data;
    return (
        <div className="grid gap-4">
            {me.user.role === "employee" && !admission.admitted && admission.rules.length > 0 ? (
                <FormMessage kind="info">
                    {t("training.admissionPending")}
                    <AdmissionRulesStatus rules={admission.rules} />
                </FormMessage>
            ) : null}
            {courses.length === 0 ? (
                <Card>
                    <EmptyState icon={BookOpen} title={t("training.noCourses")}>
                        {t("training.noCoursesHint")}
                    </EmptyState>
                </Card>
            ) : (
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {courses.map((course) => (
                        <CourseCard key={course.id} course={course} />
                    ))}
                </div>
            )}
        </div>
    );
}
