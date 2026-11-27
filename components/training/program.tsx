"use client";

import { ArrowRight, BookOpen, Check, ChevronUp, ClipboardCheck, GraduationCap, Lock, Plus, Trash2, Unlock, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatShort, t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { cn } from "../../lib/utils.ts";
import { useSession } from "../session.tsx";
import { OptimisticCheckbox, useBranchQuery } from "../settings/members.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { Button, buttonVariants } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Checkbox, Input, Textarea } from "../ui/input.tsx";
import { Table, Td, Th, THead, Tr } from "../ui/table.tsx";
import type { MyCourses, RuleStatus } from "./types.ts";

export function useProgram() {
    return useApiData("training-my", (signal) => api<MyCourses>("/api/training/courses", { signal }));
}

/** Состояние правил допуска (для экрана результата теста) */
export function AdmissionRulesStatus({ rules }: { rules: RuleStatus[] }) {
    return (
        <ul className="mt-2 grid gap-1.5">
            {rules.map((rule) => (
                <li key={rule.courseKey} className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={rule.satisfied ? "success" : "warning"}>{rule.satisfied ? t("training.passed") : t("training.notPassed")}</StatusPill>
                    <span>{rule.bestPercent === null ? t("prog.stepTestNone", { min: rule.minScorePercent }) : t("prog.stepTestBest", { best: rule.bestPercent, min: rule.minScorePercent })}</span>
                </li>
            ))}
        </ul>
    );
}

function Step({ index, icon: Icon, title, text, state }: { index: number; icon: typeof BookOpen; title: string; text: string; state: "done" | "current" | "todo" }) {
    return (
        <li className={cn("relative flex items-start gap-3 rounded-2xl border p-4 transition-colors", state === "done" ? "border-success/30 bg-success/5" : state === "current" ? "border-primary/40 bg-primary/5 shadow-sm" : "border-border bg-surface")}>
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", state === "done" ? "bg-success text-white" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {state === "done" ? <Check className="size-5" /> : <Icon className="size-5" />}
            </span>
            <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {index}. {title}
                </div>
                <div className="mt-0.5 font-semibold">{text}</div>
            </div>
        </li>
    );
}

/** Сотрудник: одна программа — уроки, тест и доступ к рабочему месту */
export function EmployeeProgram() {
    const { me } = useSession();
    const data = useProgram();
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    const course = data.data.courses[0];
    if (!course) return <Spinner label={t("common.loading")} />;
    const admitted = data.data.admission.admitted;
    const lessonsDone = course.lessons.total > 0 && course.lessons.completed === course.lessons.total;
    const testLabel = course.openAttempt ? t("prog.continueTest") : course.attempts > 0 ? t("prog.retakeTest") : t("prog.startTest");
    return (
        <div className="grid max-w-4xl gap-5">
            <Card className="relative overflow-hidden p-0">
                <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,color-mix(in_oklab,var(--brand-primary)_18%,transparent),transparent_60%)]" aria-hidden />
                <div className="relative grid gap-3 p-6 sm:p-8">
                    <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                        {admitted ? <Unlock className="size-6" /> : <GraduationCap className="size-6" />}
                    </span>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-[28px]">{admitted ? t("prog.doneTitle") : t("prog.welcome", { company: me.company.name })}</h2>
                    <p className="max-w-2xl text-muted-foreground">{admitted ? t("prog.doneText") : course.description || t("prog.welcomeText")}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                        {admitted ? (
                            <Link href="/" className={buttonVariants()}>
                                {t("prog.toWork")}
                                <ArrowRight className="size-4" />
                            </Link>
                        ) : null}
                        <Link href={`/training/${course.id}`} className={buttonVariants({ variant: admitted || lessonsDone ? "secondary" : "primary" })}>
                            <BookOpen className="size-4" />
                            {t("prog.openLessons")}
                        </Link>
                        <Link href={course.openAttempt ? `/training/${course.id}/test?attempt=${course.openAttempt.id}` : `/training/${course.id}/test`} className={buttonVariants({ variant: !admitted && lessonsDone ? "primary" : "secondary" })}>
                            <ClipboardCheck className="size-4" />
                            {testLabel}
                        </Link>
                    </div>
                </div>
            </Card>
            <ol className="grid gap-3 md:grid-cols-3">
                <Step index={1} icon={BookOpen} title={t("prog.step.lessons")} text={t("prog.stepLessons", { done: course.lessons.completed, total: course.lessons.total })} state={lessonsDone ? "done" : "current"} />
                <Step
                    index={2}
                    icon={ClipboardCheck}
                    title={t("prog.step.test")}
                    text={course.bestPercent === null ? t("prog.stepTestNone", { min: course.minScorePercent }) : t("prog.stepTestBest", { best: course.bestPercent, min: course.minScorePercent })}
                    state={course.passed || admitted ? "done" : lessonsDone ? "current" : "todo"}
                />
                <Step index={3} icon={admitted ? Unlock : Lock} title={t("prog.step.access")} text={admitted ? t("prog.stepAccessOpen") : t("prog.stepAccessClosed")} state={admitted ? "done" : "todo"} />
            </ol>
        </div>
    );
}

// --- Руководитель и директор: прогресс сотрудников -----------------------

type ProgressRow = {
    id: string;
    displayName: string;
    branchName: string | null;
    admitted: boolean;
    courses: Array<{ lessons: { total: number; completed: number; percent: number }; inProgress: boolean; bestPercent: number | null; minScorePercent: number; passed: boolean }>;
};

function statusOf(row: ProgressRow): { tone: "success" | "info" | "warning" | "neutral"; label: string } {
    const course = row.courses[0];
    if (row.admitted) return { tone: "success", label: t("prog.status.done") };
    if (course?.inProgress || (course && course.bestPercent !== null)) return { tone: "info", label: t("prog.status.testing") };
    if (course && course.lessons.completed > 0) return { tone: "warning", label: t("prog.status.learning") };
    return { tone: "neutral", label: t("prog.status.new") };
}

export function TeamTraining() {
    const { me } = useSession();
    const query = useBranchQuery();
    const data = useApiData(`training-progress${query}`, (signal) => api<{ employees: ProgressRow[] }>(`/api/training/progress${query}`, { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    if (data.data.employees.length === 0) {
        return (
            <Card>
                <EmptyState icon={Users} title={t("prog.teamEmpty")}>
                    {t("prog.teamEmptyText")}
                </EmptyState>
            </Card>
        );
    }
    return (
        <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t("prog.markHint")}</p>
            <Table aria-busy={data.loading}>
                <THead>
                    <tr>
                        <Th>{t("prog.col.employee")}</Th>
                        <Th>{t("prog.col.lessons")}</Th>
                        <Th>{t("prog.col.test")}</Th>
                        <Th>{t("prog.col.status")}</Th>
                        <Th className="text-right">{t("team.admittedLower")}</Th>
                    </tr>
                </THead>
                <tbody>
                    {data.data.employees.map((row) => {
                        const course = row.courses[0];
                        const status = statusOf(row);
                        return (
                            <Tr key={`${row.id}-${row.admitted}`}>
                                <Td className="min-w-48">
                                    <div className="flex items-center gap-3">
                                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{row.displayName.slice(0, 1).toUpperCase()}</span>
                                        <div className="min-w-0">
                                            <div className="font-semibold break-anywhere">{row.displayName}</div>
                                            {row.branchName && me.user.role === "director" ? <div className="text-[13px] text-muted-foreground">{row.branchName}</div> : null}
                                        </div>
                                    </div>
                                </Td>
                                <Td className="min-w-40">
                                    {course ? (
                                        <div className="grid gap-1.5">
                                            <span className="text-sm">
                                                {course.lessons.completed} / {course.lessons.total}
                                            </span>
                                            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                                                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${course.lessons.percent}%` }} />
                                            </div>
                                        </div>
                                    ) : (
                                        "—"
                                    )}
                                </Td>
                                <Td className="whitespace-nowrap">
                                    {course?.bestPercent === null || !course ? <span className="text-muted-foreground">—</span> : <strong className={course.passed ? "text-success" : undefined}>{course.bestPercent}%</strong>}
                                    {course ? <span className="text-muted-foreground"> / {course.minScorePercent}%</span> : null}
                                </Td>
                                <Td>
                                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                                </Td>
                                <Td className="text-right">
                                    <div className="inline-flex">
                                        <OptimisticCheckbox
                                            label={t("team.admittedLower")}
                                            checked={row.admitted}
                                            onToggle={async (next) => {
                                                await api(`/api/users/${row.id}/admission`, { method: "PUT", body: { admitted: next } });
                                                data.reload();
                                            }}
                                        />
                                    </div>
                                </Td>
                            </Tr>
                        );
                    })}
                </tbody>
            </Table>
        </div>
    );
}

// --- Директор: редактор программы ----------------------------------------

type Program = {
    title: string;
    description: string;
    version: number;
    updatedAt: number;
    passPercent: number;
    lessons: Array<{ title: string; body: string; minutes: number | null }>;
    questions: Array<{ text: string; options: string[]; correct: number[] }>;
};

export function ProgramEditor() {
    const data = useApiData("training-program", (signal) => api<Program>("/api/training/program", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    return <ProgramForm key={data.data.version} initial={data.data} />;
}

function move<T>(list: T[], index: number): T[] {
    if (index <= 0) return list;
    const next = [...list];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    return next;
}

function ProgramForm({ initial }: { initial: Program }) {
    const { me } = useSession();
    const [program, setProgram] = useState(initial);
    const [saved, setSaved] = useState<Program | null>(null);
    const action = useAction();
    const set = (patch: Partial<Program>) => {
        setSaved(null);
        setProgram((current) => ({ ...current, ...patch }));
    };
    const setLesson = (index: number, patch: Partial<Program["lessons"][number]>) => set({ lessons: program.lessons.map((lesson, i) => (i === index ? { ...lesson, ...patch } : lesson)) });
    const setQuestion = (index: number, patch: Partial<Program["questions"][number]>) => set({ questions: program.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)) });
    const current = saved ?? initial;

    return (
        <Form
            busy={action.busy}
            submitLabel={t("common.save")}
            className="max-w-4xl"
            onSubmit={() =>
                action.run(async () => {
                    const result = await api<Program>("/api/training/program", { method: "PUT", body: program });
                    setSaved(result);
                })
            }
        >
            <Card className="grid gap-4 p-5">
                <p className="text-sm text-muted-foreground">{t("prog.editorIntro")}</p>
                <p className="text-[13px] text-muted-foreground">{t("prog.updated", { version: current.version, date: formatShort(current.updatedAt, me.company.timezone) })}</p>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <Field label={t("prog.name")}>
                        <Input value={program.title} maxLength={120} onChange={(event) => set({ title: event.target.value })} />
                    </Field>
                    <Field label={t("prog.pass")}>
                        <Input type="number" min={1} max={100} value={program.passPercent} onChange={(event) => set({ passPercent: Number(event.target.value) })} />
                    </Field>
                </div>
                <Field label={t("prog.description")} optional>
                    <Textarea rows={2} maxLength={500} value={program.description} onChange={(event) => set({ description: event.target.value })} />
                </Field>
            </Card>

            <h3 className="mt-2 text-lg font-bold">{t("prog.lessonsTitle")}</h3>
            {program.lessons.map((lesson, index) => (
                <Card key={index} className="grid gap-3 p-5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{t("prog.lesson", { n: index + 1 })}</span>
                        <div className="flex gap-1">
                            {index > 0 ? (
                                <Button variant="ghost" size="sm" onClick={() => set({ lessons: move(program.lessons, index) })}>
                                    <ChevronUp className="size-4" />
                                    {t("prog.moveUp")}
                                </Button>
                            ) : null}
                            {program.lessons.length > 1 ? (
                                <Button variant="ghost" size="sm" onClick={() => set({ lessons: program.lessons.filter((_, i) => i !== index) })}>
                                    <Trash2 className="size-4" />
                                    {t("prog.remove")}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                        <Field label={t("prog.lessonTitle")}>
                            <Input value={lesson.title} maxLength={200} onChange={(event) => setLesson(index, { title: event.target.value })} />
                        </Field>
                        <Field label={t("prog.lessonMinutes")} optional>
                            <Input type="number" min={1} max={600} value={lesson.minutes ?? ""} onChange={(event) => setLesson(index, { minutes: event.target.value ? Number(event.target.value) : null })} />
                        </Field>
                    </div>
                    <Field label={t("prog.lessonBody")}>
                        <Textarea rows={5} value={lesson.body} onChange={(event) => setLesson(index, { body: event.target.value })} />
                    </Field>
                </Card>
            ))}
            <div>
                <Button variant="secondary" onClick={() => set({ lessons: [...program.lessons, { title: "", body: "", minutes: null }] })}>
                    <Plus className="size-4" />
                    {t("prog.addLesson")}
                </Button>
            </div>

            <h3 className="mt-2 text-lg font-bold">{t("prog.questionsTitle")}</h3>
            {program.questions.map((question, index) => (
                <Card key={index} className="grid gap-3 p-5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{t("prog.question", { n: index + 1 })}</span>
                        {program.questions.length > 1 ? (
                            <Button variant="ghost" size="sm" onClick={() => set({ questions: program.questions.filter((_, i) => i !== index) })}>
                                <Trash2 className="size-4" />
                                {t("prog.remove")}
                            </Button>
                        ) : null}
                    </div>
                    <Field label={t("prog.questionText")}>
                        <Input value={question.text} maxLength={2000} onChange={(event) => setQuestion(index, { text: event.target.value })} />
                    </Field>
                    <div className="grid gap-2">
                        {question.options.map((option, optionIndex) => (
                            <div key={optionIndex} className="flex items-center gap-2">
                                <Input
                                    aria-label={`${t("prog.question", { n: index + 1 })}: ${t("prog.option", { n: optionIndex + 1 })}`}
                                    placeholder={t("prog.option", { n: optionIndex + 1 })}
                                    value={option}
                                    maxLength={2000}
                                    onChange={(event) => setQuestion(index, { options: question.options.map((item, i) => (i === optionIndex ? event.target.value : item)) })}
                                />
                                <div className="shrink-0">
                                    <Checkbox
                                        label={t("prog.correct")}
                                        checked={question.correct.includes(optionIndex)}
                                        onChange={(event) => setQuestion(index, { correct: event.target.checked ? [...question.correct, optionIndex] : question.correct.filter((item) => item !== optionIndex) })}
                                    />
                                </div>
                                {question.options.length > 2 ? (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`${t("prog.remove")}: ${t("prog.option", { n: optionIndex + 1 })}`}
                                        onClick={() =>
                                            setQuestion(index, {
                                                options: question.options.filter((_, i) => i !== optionIndex),
                                                correct: question.correct.filter((item) => item !== optionIndex).map((item) => (item > optionIndex ? item - 1 : item)),
                                            })
                                        }
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    {question.options.length < 10 ? (
                        <div>
                            <Button variant="ghost" size="sm" onClick={() => setQuestion(index, { options: [...question.options, ""] })}>
                                <Plus className="size-4" />
                                {t("prog.addOption")}
                            </Button>
                        </div>
                    ) : null}
                </Card>
            ))}
            <div>
                <Button variant="secondary" onClick={() => set({ questions: [...program.questions, { text: "", options: ["", ""], correct: [] }] })}>
                    <Plus className="size-4" />
                    {t("prog.addQuestion")}
                </Button>
            </div>
            {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            {saved ? <FormMessage kind="success">{t("prog.saved", { version: saved.version })}</FormMessage> : null}
        </Form>
    );
}
