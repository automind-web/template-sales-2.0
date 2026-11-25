"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SectionGate } from "../../../../../components/app-shell.tsx";
import { useSession } from "../../../../../components/session.tsx";
import { AdmissionRulesStatus } from "../../../../../components/training/my-courses.tsx";
import type { AttemptView, RuleStatus } from "../../../../../components/training/types.ts";
import { Button, buttonVariants } from "../../../../../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle, Spinner } from "../../../../../components/ui/card.tsx";
import { Dialog } from "../../../../../components/ui/dialog.tsx";
import { ErrorRetry } from "../../../../../components/ui/error-retry.tsx";
import { FormMessage } from "../../../../../components/ui/field.tsx";
import { Form } from "../../../../../components/ui/form.tsx";
import { t } from "../../../../../i18n/index.ts";
import { api, errorMessage } from "../../../../../lib/api.ts";
import { useApiData } from "../../../../../lib/use-api.ts";

type AttemptResponse = { attempt: AttemptView };
type SubmitResponse = AttemptResponse & { admission: { admitted: boolean; granted: boolean; rules: RuleStatus[] } };

export default function TestPage() {
    return (
        <SectionGate section="training">
            <TestScreen />
        </SectionGate>
    );
}

/**
 * Адрес /training/:id/test начинает или продолжает попытку и сразу заменяется
 * на ?attempt=<id>, чтобы перезагрузка страницы результата не начинала новый тест.
 */
function TestScreen() {
    const params = useParams<{ courseId: string }>();
    const courseId = typeof params?.courseId === "string" ? params.courseId : "";
    const search = useSearchParams();
    const attemptId = search?.get("attempt") ?? "";
    const router = useRouter();
    const pathname = usePathname() ?? "";

    const data = useApiData(`attempt-${courseId}-${attemptId}`, (signal) =>
        attemptId
            ? api<AttemptResponse>(`/api/training/attempts/${encodeURIComponent(attemptId)}`, { signal })
            : api<AttemptResponse>(`/api/training/courses/${encodeURIComponent(courseId)}/attempts`, { method: "POST", signal })
    );

    useEffect(() => {
        if (!attemptId && data.data) router.replace(`${pathname}?attempt=${data.data.attempt.id}`, { scroll: false });
    }, [attemptId, data.data, pathname, router]);

    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    return <AttemptForm key={data.data.attempt.id} courseId={courseId} initial={data.data.attempt} />;
}

function AttemptForm({ courseId, initial }: { courseId: string; initial: AttemptView }) {
    const { reload: reloadSession } = useSession();
    const [attempt, setAttempt] = useState(initial);
    const [answers, setAnswers] = useState<Record<string, string[]>>(initial.answers);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [admission, setAdmission] = useState<SubmitResponse["admission"] | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestAnswers = useRef(answers);

    const unanswered = attempt.questions.filter((question) => !(answers[question.key]?.length)).length;

    function choose(questionKey: string, optionKey: string, kind: "single" | "multiple", checked: boolean) {
        setAnswers((current) => {
            const previous = current[questionKey] ?? [];
            const next = kind === "single" ? [optionKey] : checked ? [...new Set([...previous, optionKey])] : previous.filter((key) => key !== optionKey);
            const updated = { ...current, [questionKey]: next };
            latestAnswers.current = updated;
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
                api(`/api/training/attempts/${attempt.id}/answers`, { method: "PUT", body: { answers: latestAnswers.current } }).catch(() => undefined);
            }, 600);
            return updated;
        });
    }

    useEffect(
        () => () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
        },
        []
    );

    async function submit() {
        setConfirm(false);
        setBusy(true);
        setError(null);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        try {
            const result = await api<SubmitResponse>(`/api/training/attempts/${attempt.id}/submit`, { method: "POST", body: { answers } });
            setAttempt(result.attempt);
            setAdmission(result.admission);
            if (result.admission.granted) await reloadSession();
            window.scrollTo({ top: 0 });
        } catch (caught) {
            // Ответы на экране сохраняются: можно повторить отправку.
            setError(errorMessage(caught));
        } finally {
            setBusy(false);
        }
    }

    const back = (
        <Link href={`/training/${courseId}`} className="text-sm text-primary hover:underline">
            ← {t("training.backToCourse")}
        </Link>
    );

    if (attempt.status === "submitted" && attempt.result) {
        const result = attempt.result;
        return (
            <div className="grid max-w-2xl gap-3">
                {back}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("training.resultTitle")}</CardTitle>
                        <span className="text-xs text-muted-foreground">
                            {attempt.title} · {t("training.version", { version: attempt.version })}
                        </span>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                        <p className="text-lg font-semibold" role="status">
                            {t("training.result", { correct: result.correct, total: result.total, percent: result.percent })}
                        </p>
                        <FormMessage kind={result.passed ? "success" : "error"}>
                            {result.passed ? t("training.resultPassed", { min: result.minScorePercent }) : t("training.resultFailed", { min: result.minScorePercent })}
                        </FormMessage>
                        {admission?.granted ? <FormMessage kind="success">{t("training.admissionGranted")}</FormMessage> : null}
                        {admission && !admission.admitted && admission.rules.length > 0 ? (
                            <FormMessage kind="info">
                                {t("training.admissionPending")}
                                <AdmissionRulesStatus rules={admission.rules} />
                            </FormMessage>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            {admission?.granted ? (
                                <Link href="/crm" className={buttonVariants({ variant: "primary" })}>
                                    {t("nav.crm")}
                                </Link>
                            ) : null}
                            <Link href={`/training/${courseId}/test`} className={buttonVariants({ variant: admission?.granted ? "secondary" : "primary" })}>
                                {t("training.retakeTest")}
                            </Link>
                            <Link href="/training" className={buttonVariants({ variant: "secondary" })}>
                                {t("training.backToList")}
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="grid max-w-2xl gap-3">
            {back}
            <h1 className="text-xl font-semibold break-anywhere">{attempt.title}</h1>
            <p className="text-sm text-muted-foreground">
                {t("training.version", { version: attempt.version })} · {t("training.autosaved")}
            </p>
            {attempt.latestVersion > attempt.version ? <FormMessage kind="info">{t("training.attemptVersionNotice", { version: attempt.version, latest: attempt.latestVersion })}</FormMessage> : null}
            <Form
                onSubmit={() => (unanswered > 0 ? setConfirm(true) : submit())}
                busy={busy}
                submitLabel={t("training.submit")}
                secondary={
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                        {t("training.answered", { count: attempt.questions.length - unanswered, total: attempt.questions.length })}
                    </span>
                }
            >
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                {attempt.questions.map((question, index) => (
                    <fieldset key={question.key} className="grid gap-2 rounded-lg border border-border bg-surface p-3">
                        <legend className="float-left w-full font-medium break-anywhere">
                            {index + 1}. {question.text}
                        </legend>
                        <p className="text-xs text-muted-foreground">{question.kind === "single" ? t("training.single") : t("training.multiple")}</p>
                        {question.options.map((option) => {
                            const checked = (answers[question.key] ?? []).includes(option.key);
                            return (
                                <label key={option.key} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted has-[:checked]:bg-selected has-[:checked]:text-selected-foreground">
                                    <input
                                        type={question.kind === "single" ? "radio" : "checkbox"}
                                        name={`q-${question.key}`}
                                        className="mt-0.5 size-4 shrink-0 accent-[var(--brand-primary)]"
                                        checked={checked}
                                        onChange={(event) => choose(question.key, option.key, question.kind, event.target.checked)}
                                    />
                                    <span className="break-anywhere">{option.text}</span>
                                </label>
                            );
                        })}
                    </fieldset>
                ))}
            </Form>
            <Dialog open={confirm} onClose={() => setConfirm(false)} title={t("training.submit")} description={t("training.submitConfirm", { count: unanswered })}>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void submit()} data-autofocus>
                        {t("training.submit")}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm(false)}>
                        {t("common.cancel")}
                    </Button>
                </div>
            </Dialog>
        </div>
    );
}
