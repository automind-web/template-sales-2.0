"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, SectionGate } from "../../../../components/app-shell.tsx";
import { RichText } from "../../../../components/rich-text.tsx";
import { ProgressBar } from "../../../../components/training/progress-bar.tsx";
import { Button, buttonVariants } from "../../../../components/ui/button.tsx";
import { Badge, Card, CardContent, Spinner } from "../../../../components/ui/card.tsx";
import { ErrorRetry } from "../../../../components/ui/error-retry.tsx";
import { FormMessage } from "../../../../components/ui/field.tsx";
import { t } from "../../../../i18n/index.ts";
import { api, errorMessage } from "../../../../lib/api.ts";
import { useApiData } from "../../../../lib/use-api.ts";

type Detail = {
    course: {
        id: string;
        title: string;
        description: string | null;
        version: number;
        minScorePercent: number;
        requiredForAdmission: boolean;
        questions: number;
        progress: { total: number; completed: number; percent: number };
        lessons: Array<{ key: string; title: string; body: string; durationMinutes: number | null; completed: boolean; files: Array<{ id: string; filename: string; size: number }> }>;
        openAttempt: { id: string; version: number } | null;
    };
};

function formatSize(bytes: number) {
    if (bytes < 1024) return t("units.bytes", { n: bytes });
    if (bytes < 1024 * 1024) return t("units.kb", { n: (bytes / 1024).toFixed(0) });
    return t("units.mb", { n: (bytes / 1024 / 1024).toFixed(1) });
}

export default function CoursePage() {
    return (
        <SectionGate section="training">
            <Course />
        </SectionGate>
    );
}

function Course() {
    const params = useParams<{ courseId: string }>();
    const courseId = typeof params?.courseId === "string" ? params.courseId : "";
    const data = useApiData(`course-${courseId}`, (signal) => api<Detail>(`/api/training/courses/${encodeURIComponent(courseId)}`, { signal }));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function complete(lessonKey: string) {
        setBusy(lessonKey);
        setError(null);
        try {
            await api(`/api/training/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonKey)}/complete`, { method: "POST" });
            data.reload();
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setBusy(null);
        }
    }

    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    const course = data.data.course;
    return (
        <>
            <p className="mb-2 text-sm">
                <Link href="/training" className="text-primary hover:underline">
                    ← {t("training.backToList")}
                </Link>
            </p>
            <PageHeader
                title={course.title}
                actions={
                    <Link href={`/training/${course.id}/test`} className={buttonVariants({ variant: "primary" })}>
                        {course.openAttempt ? t("training.continueTest") : t("training.startTest")}
                    </Link>
                }
            >
                <p className="text-sm text-muted-foreground">
                    {t("training.version", { version: course.version })} · {t("training.questions", { count: course.questions })} · {t("training.minScore", { percent: course.minScorePercent })}
                </p>
            </PageHeader>
            <div className="grid max-w-3xl gap-3">
                {course.description ? <p className="text-sm break-anywhere">{course.description}</p> : null}
                {course.requiredForAdmission ? (
                    <div>
                        <Badge tone="primary">{t("training.requiredForAdmission")}</Badge>
                    </div>
                ) : null}
                <ProgressBar percent={course.progress.percent} label={t("training.lessonsProgress", { done: course.progress.completed, total: course.progress.total })} />
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                <h2 className="mt-2 text-base font-semibold">{t("training.lessons")}</h2>
                {course.lessons.map((lesson, index) => (
                    <Card key={lesson.key} id={`lesson-${lesson.key}`}>
                        <details open={!lesson.completed && course.lessons.findIndex((item) => !item.completed) === index}>
                            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                                <span className="font-medium break-anywhere">
                                    {index + 1}. {lesson.title}
                                    {lesson.durationMinutes ? <span className="ml-2 text-xs font-normal text-muted-foreground">{t("training.minutes", { count: lesson.durationMinutes })}</span> : null}
                                </span>
                                <Badge tone={lesson.completed ? "success" : "neutral"}>{lesson.completed ? t("training.done") : t("training.notDone")}</Badge>
                            </summary>
                            <CardContent className="grid gap-3 border-t border-border">
                                {lesson.body ? <RichText text={lesson.body} /> : null}
                                {lesson.files.length ? (
                                    <div>
                                        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("training.files")}</p>
                                        <ul className="grid gap-1 text-sm">
                                            {lesson.files.map((file) => (
                                                <li key={file.id}>
                                                    <a className="text-primary hover:underline break-anywhere" href={`/api/training/files/${file.id}`} target="_blank" rel="noopener">
                                                        {file.filename}
                                                    </a>{" "}
                                                    <span className="text-xs text-muted-foreground">({formatSize(file.size)})</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                                {!lesson.completed ? (
                                    <div>
                                        <Button variant="secondary" disabled={busy !== null} onClick={() => void complete(lesson.key)}>
                                            {busy === lesson.key ? t("common.loading") : t("training.markDone")}
                                        </Button>
                                    </div>
                                ) : null}
                            </CardContent>
                        </details>
                    </Card>
                ))}
            </div>
        </>
    );
}
