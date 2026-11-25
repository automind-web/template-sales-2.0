"use client";

import Link from "next/link";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { buttonVariants } from "../ui/button.tsx";
import { Badge, Card, CardContent, EmptyState, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { FormMessage } from "../ui/field.tsx";
import { ProgressBar } from "./progress-bar.tsx";
import type { CourseSummary, MyCourses as MyCoursesData, RuleStatus } from "./types.ts";

export function useMyCourses() {
    return useApiData("training-my", (signal) => api<MyCoursesData>("/api/training/courses", { signal }));
}

export function AdmissionRulesStatus({ rules }: { rules: RuleStatus[] }) {
    return (
        <ul className="mt-1 grid gap-1">
            {rules.map((rule) => (
                <li key={rule.courseKey} className="flex flex-wrap items-center gap-2">
                    <Badge tone={rule.satisfied ? "success" : "warning"}>{rule.satisfied ? t("training.passed") : t("training.notPassed")}</Badge>
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

function CourseCard({ course }: { course: CourseSummary }) {
    const testLabel = course.openAttempt ? t("training.continueTest") : course.attempts > 0 ? t("training.retakeTest") : t("training.startTest");
    return (
        <Card>
            <CardContent className="grid gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h3 className="font-semibold break-anywhere">
                            <Link href={`/training/${course.id}`} className="hover:underline">
                                {course.title}
                            </Link>
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            {t("training.version", { version: course.version })} · {t("training.questions", { count: course.questions })}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {course.requiredForAdmission ? <Badge tone="primary">{t("training.requiredForAdmission")}</Badge> : null}
                        {course.openAttempt ? <Badge tone="warning">{t("training.inProgress")}</Badge> : null}
                        {course.bestPercent !== null ? <Badge tone={course.passed ? "success" : "danger"}>{course.passed ? t("training.passed") : t("training.notPassed")}</Badge> : null}
                    </div>
                </div>
                {course.description ? <p className="text-sm text-muted-foreground break-anywhere">{course.description}</p> : null}
                <ProgressBar percent={course.lessons.percent} label={t("training.lessonsProgress", { done: course.lessons.completed, total: course.lessons.total })} />
                <p className="text-xs text-muted-foreground">
                    {t("training.minScore", { percent: course.minScorePercent })} · {course.bestPercent === null ? t("training.noAttempts") : t("training.bestScore", { percent: course.bestPercent })}
                </p>
                <div className="flex flex-wrap gap-2">
                    <Link href={`/training/${course.id}/test`} className={buttonVariants({ variant: "primary" })}>
                        {testLabel}
                    </Link>
                    <Link href={`/training/${course.id}`} className={buttonVariants({ variant: "secondary" })}>
                        {t("training.openCourse")}
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}

export function MyCourses({ data }: { data: ReturnType<typeof useMyCourses> }) {
    const { me } = useSession();
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    const { courses, admission } = data.data;
    const isEmployee = me.user.role === "employee";
    return (
        <div className="grid gap-3">
            {isEmployee && !admission.admitted && admission.rules.length > 0 ? (
                <FormMessage kind="info">
                    {t("training.admissionPending")}
                    <AdmissionRulesStatus rules={admission.rules} />
                </FormMessage>
            ) : null}
            {courses.length === 0 ? (
                <Card>
                    <EmptyState title={t("training.noCourses")}>
                        <p className="text-sm text-muted-foreground">{t("training.noCoursesHint")}</p>
                    </EmptyState>
                </Card>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {courses.map((course) => (
                        <CourseCard key={course.id} course={course} />
                    ))}
                </div>
            )}
        </div>
    );
}
