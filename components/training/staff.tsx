"use client";

import { BookOpen, Users } from "lucide-react";
import { Fragment, useState } from "react";
import { formatDateTime, t } from "../../i18n/index.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useAction } from "../../lib/use-action.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { useBranchQuery } from "../settings/members.tsx";
import { StatusPill } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, EmptyState, Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FieldGrid, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";
import { ListCard, ListRow, Table, Td, Th, THead, Tr } from "../ui/table.tsx";
import { AdmissionRulesStatus, CourseStatus } from "./my-courses.tsx";
import type { RuleStatus } from "./types.ts";

// --- Прогресс сотрудников ------------------------------------------------

type ProgressRow = {
    id: string;
    displayName: string;
    login: string;
    branchName: string | null;
    admitted: boolean;
    rules: RuleStatus[];
    courses: Array<{
        courseId: string;
        title: string;
        lessons: { total: number; completed: number; percent: number };
        attempts: number;
        inProgress: boolean;
        bestPercent: number | null;
        lastPercent: number | null;
        lastSubmittedAt: number | null;
        lastVersion: number | null;
        minScorePercent: number;
        passed: boolean;
    }>;
};

/** Сотрудники × курсы: уроки, попытки, лучший и последний результат, статус */
export function TeamProgress() {
    const { me } = useSession();
    const query = useBranchQuery();
    const data = useApiData(`training-progress${query}`, (signal) => api<{ employees: ProgressRow[] }>(`/api/training/progress${query}`, { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    if (data.data.employees.length === 0) {
        return (
            <Card>
                <EmptyState icon={Users} title={t("training.noEmployees")} />
            </Card>
        );
    }
    return (
        <Table aria-busy={data.loading}>
            <THead>
                <tr>
                    <Th>{t("training.employee")}</Th>
                    <Th>{t("training.course")}</Th>
                    <Th>{t("training.lessons")}</Th>
                    <Th className="text-right">{t("training.attemptsShort")}</Th>
                    <Th className="text-right">{t("training.best")}</Th>
                    <Th>{t("training.last")}</Th>
                    <Th>{t("common.status")}</Th>
                </tr>
            </THead>
            <tbody>
                {data.data.employees.map((person) => {
                    const rows = Math.max(1, person.courses.length);
                    const employeeCell = (
                        <Td rowSpan={rows} className="min-w-56 align-top">
                            <div className="font-bold break-anywhere">{person.displayName}</div>
                            <div className="text-[13px] text-muted-foreground break-anywhere">
                                {person.login}
                                {person.branchName ? ` · ${person.branchName}` : ""}
                            </div>
                            <div className="mt-1.5">
                                <StatusPill tone={person.admitted ? "success" : "warning"}>{person.admitted ? t("team.admitted") : t("team.notAdmitted")}</StatusPill>
                            </div>
                            {!person.admitted && person.rules.length > 0 ? (
                                <div className="text-[13px]">
                                    <AdmissionRulesStatus rules={person.rules} />
                                </div>
                            ) : null}
                        </Td>
                    );
                    if (person.courses.length === 0) {
                        return (
                            <Tr key={person.id}>
                                {employeeCell}
                                <Td colSpan={6} className="text-muted-foreground">
                                    {t("training.noAssignedCourses")}
                                </Td>
                            </Tr>
                        );
                    }
                    return (
                        <Fragment key={person.id}>
                            {person.courses.map((course, index) => (
                                <Tr key={course.courseId} className={index > 0 ? "border-t-0" : undefined}>
                                    {index === 0 ? employeeCell : null}
                                    <Td className="min-w-48 font-semibold break-anywhere">{course.title}</Td>
                                    <Td className="whitespace-nowrap">
                                        {course.lessons.completed} / {course.lessons.total}
                                    </Td>
                                    <Td className="text-right">{course.attempts}</Td>
                                    <Td className="text-right font-semibold whitespace-nowrap">
                                        {course.bestPercent === null ? t("common.none") : `${course.bestPercent}%`}
                                        <span className="ml-1 font-normal text-muted-foreground">/ {course.minScorePercent}%</span>
                                    </Td>
                                    <Td className="text-[13px] whitespace-nowrap text-muted-foreground">
                                        {course.lastPercent !== null && course.lastVersion !== null ? (
                                            <>
                                                {t("training.lastCell", { percent: course.lastPercent, version: course.lastVersion })}
                                                {course.lastSubmittedAt ? <div>{formatDateTime(course.lastSubmittedAt, me.company.timezone)}</div> : null}
                                            </>
                                        ) : (
                                            t("common.none")
                                        )}
                                    </Td>
                                    <Td>
                                        <CourseStatus inProgress={course.inProgress} bestPercent={course.bestPercent} passed={course.passed} />
                                    </Td>
                                </Tr>
                            ))}
                        </Fragment>
                    );
                })}
            </tbody>
        </Table>
    );
}

// --- Курсы и версии ------------------------------------------------------

type CatalogCourse = {
    id: string;
    key: string;
    title: string;
    archived: boolean;
    versions: Array<{ id: string; version: number; title: string; createdAt: number; externalRef: string | null; lessons: number; questions: number; passPercent: number }>;
};

export function useCatalog() {
    return useApiData("training-catalog", (signal) => api<{ courses: CatalogCourse[] }>("/api/training/catalog", { signal }));
}

/** История утверждённых редакций: текущая сверху, прежние не изменяются */
export function Catalog() {
    const { me } = useSession();
    const data = useCatalog();
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    if (data.data.courses.length === 0) {
        return (
            <Card>
                <EmptyState icon={BookOpen} title={t("training.catalogEmptyTitle")}>
                    {t("training.catalogEmpty")}
                </EmptyState>
            </Card>
        );
    }
    return (
        <Table>
            <THead>
                <tr>
                    <Th>{t("training.course")}</Th>
                    <Th>{t("training.edition")}</Th>
                    <Th className="text-right">{t("training.lessons")}</Th>
                    <Th className="text-right">{t("training.questionsShort")}</Th>
                    <Th className="text-right">{t("training.passScore")}</Th>
                    <Th>{t("training.uploaded")}</Th>
                </tr>
            </THead>
            <tbody>
                {data.data.courses.map((course) => (
                    <Fragment key={course.id}>
                        {course.versions.map((version, index) => (
                            <Tr key={version.id} className={index > 0 ? "border-t-0" : undefined}>
                                {index === 0 ? (
                                    <Td rowSpan={course.versions.length} className="min-w-56 align-top">
                                        <div className="font-bold break-anywhere">{course.title}</div>
                                        <div className="font-mono text-[13px] text-muted-foreground">{course.key}</div>
                                    </Td>
                                ) : null}
                                <Td className="whitespace-nowrap">
                                    {index === 0 ? <StatusPill tone="info">{t("training.version", { version: version.version })}</StatusPill> : <span className="pl-2.5 text-muted-foreground">{t("training.version", { version: version.version })}</span>}
                                </Td>
                                <Td className="text-right">{version.lessons}</Td>
                                <Td className="text-right">{version.questions}</Td>
                                <Td className="text-right">{version.passPercent}%</Td>
                                <Td className="text-[13px] whitespace-nowrap text-muted-foreground">
                                    {formatDateTime(version.createdAt, me.company.timezone)}
                                    {version.externalRef ? <div className="font-mono">{version.externalRef}</div> : null}
                                </Td>
                            </Tr>
                        ))}
                    </Fragment>
                ))}
            </tbody>
        </Table>
    );
}

// --- Назначения ----------------------------------------------------------

type Assignment = { id: string; courseTitle: string; scope: "company" | "branch" | "user"; branchName: string | null; userName: string | null; createdAt: number; canRemove: boolean };

export function Assignments() {
    const { me } = useSession();
    const query = useBranchQuery();
    const data = useApiData(`training-assignments${query}`, (signal) => api<{ assignments: Assignment[] }>(`/api/training/assignments${query}`, { signal }));
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function remove(id: string) {
        setError(null);
        try {
            await api(`/api/training/assignments/${id}`, { method: "DELETE" });
            data.reload();
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    const scopeLabel = (row: Assignment) => (row.scope === "company" ? t("training.scope.company") : row.scope === "branch" ? `${t("training.scope.branch")} · ${row.branchName ?? ""}` : (row.userName ?? ""));

    return (
        <div className="grid max-w-5xl gap-4">
            <div>
                <Button onClick={() => setOpen(true)}>{t("training.assign")}</Button>
            </div>
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            {data.error && !data.data ? (
                <ErrorRetry message={data.error} onRetry={data.reload} />
            ) : !data.data ? (
                <Spinner label={t("common.loading")} />
            ) : data.data.assignments.length === 0 ? (
                <Card>
                    <EmptyState title={t("training.assignmentsEmptyTitle")}>{t("training.assignmentsEmpty")}</EmptyState>
                </Card>
            ) : (
                <ListCard>
                    {data.data.assignments.map((row) => (
                        <ListRow key={row.id}>
                            <div className="min-w-0 flex-1">
                                <div className="break-anywhere">
                                    <span className="font-bold">{row.courseTitle}</span> · {scopeLabel(row)}
                                </div>
                                <div className="mt-0.5 text-[13px] text-muted-foreground">{t("training.assignedAt", { date: formatDateTime(row.createdAt, me.company.timezone) })}</div>
                            </div>
                            {row.canRemove ? (
                                <Button variant="danger" size="sm" onClick={() => void remove(row.id)}>
                                    {t("training.remove")}
                                </Button>
                            ) : null}
                        </ListRow>
                    ))}
                </ListCard>
            )}
            {open ? <AssignDialog onClose={() => setOpen(false)} onSaved={data.reload} /> : null}
        </div>
    );
}

function AssignDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const { me } = useSession();
    const isDirector = me.user.role === "director";
    const catalog = useCatalog();
    const query = useBranchQuery();
    const people = useApiData(`assign-users${query}`, (signal) => api<{ users: Array<{ id: string; displayName: string; branchName: string | null }> }>(`/api/users${query}`, { signal }));
    const defaultBranch = me.selectedBranchId && me.selectedBranchId !== "*" ? me.selectedBranchId : (me.branches[0]?.id ?? "");
    const [courseId, setCourseId] = useState("");
    const [scope, setScope] = useState<"company" | "branch" | "user">("branch");
    const [branchId, setBranchId] = useState(defaultBranch);
    const [userId, setUserId] = useState("");
    const action = useAction();

    const courseOptions = catalog.data?.courses.filter((course) => !course.archived && course.versions.length > 0) ?? [];
    const selectedCourse = courseId || courseOptions[0]?.id || "";
    const userOptions = (people.data?.users ?? []).filter((user) => user.id !== me.user.id);
    const selectedUser = userId || userOptions[0]?.id || "";

    return (
        <Dialog open onClose={onClose} title={t("training.assignTitle")}>
            <Form
                variant="dialog"
                busy={action.busy}
                canSubmit={selectedCourse !== "" && (scope !== "user" || selectedUser !== "") && (scope !== "branch" || !isDirector || branchId !== "")}
                submitLabel={t("training.assign")}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={async () => {
                    if (await action.run(async () => api("/api/training/assignments", { method: "POST", body: { courseId: selectedCourse, scope, branchId, userId: selectedUser } }))) {
                        onSaved();
                        onClose();
                    }
                }}
            >
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {catalog.data && courseOptions.length === 0 ? <FormMessage kind="info">{t("training.catalogEmpty")}</FormMessage> : null}
                <Field label={t("training.course")} error={action.fields["courseId"]}>
                    <Select value={selectedCourse} onChange={(event) => setCourseId(event.target.value)} data-autofocus>
                        {courseOptions.map((course) => (
                            <option key={course.id} value={course.id}>
                                {course.title}
                            </option>
                        ))}
                    </Select>
                </Field>
                <FieldGrid>
                    <Field label={t("training.assignScope")} error={action.fields["scope"]}>
                        <Select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
                            {isDirector ? <option value="company">{t("training.scope.company")}</option> : null}
                            <option value="branch">{t("training.scope.branch")}</option>
                            <option value="user">{t("training.scope.user")}</option>
                        </Select>
                    </Field>
                    {scope === "branch" && isDirector ? (
                        <Field label={t("common.branch")} error={action.fields["branchId"]}>
                            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                                {me.branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : null}
                    {scope === "user" ? (
                        <Field label={t("training.employee")} error={action.fields["userId"]}>
                            <Select value={selectedUser} onChange={(event) => setUserId(event.target.value)}>
                                {userOptions.map((user) => (
                                    <option key={user.id} value={user.id}>
                                        {user.displayName}
                                        {user.branchName ? ` — ${user.branchName}` : ""}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : null}
                </FieldGrid>
            </Form>
        </Dialog>
    );
}

// --- Правила допуска -----------------------------------------------------

type RuleRow = { branchId: string | null; courseKey: string; minScorePercent: number; courseTitle: string | null };
type RulesData = { source: "config" | "company"; canEdit: boolean; rules: RuleRow[] };

export function AdmissionRulesEditor() {
    const data = useApiData("training-rules", (signal) => api<RulesData>("/api/training/admission-rules", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    // Форма создаётся один раз: после сохранения строки уже совпадают с сохранёнными, а сообщение не теряется.
    return <RulesForm initial={data.data} onSaved={data.reload} />;
}

function RulesForm({ initial, onSaved }: { initial: RulesData; onSaved: () => void }) {
    const { me } = useSession();
    const catalog = useCatalog();
    const [rows, setRows] = useState(initial.rules.map((rule) => ({ branchId: rule.branchId ?? "", courseKey: rule.courseKey, minScorePercent: String(rule.minScorePercent) })));
    const [saved, setSaved] = useState(false);
    const action = useAction();
    const branchName = (id: string | null) => (id ? (me.branches.find((branch) => branch.id === id)?.name ?? id) : t("common.allBranches"));
    const knownKeys = new Set(catalog.data?.courses.map((course) => course.key) ?? []);

    if (!initial.canEdit) {
        return (
            <Card className="max-w-5xl p-5">
                <p className="mb-3 text-sm text-muted-foreground">{t("training.rulesHint")}</p>
                {initial.rules.length === 0 ? (
                    <p className="text-sm">{t("training.rulesEmpty")}</p>
                ) : (
                    <ul className="grid gap-1.5 text-sm">
                        {initial.rules.map((rule, index) => (
                            <li key={index} className="break-anywhere">
                                <span className="font-semibold">{branchName(rule.branchId)}</span> · {t("role.employee")} · {rule.courseTitle ?? `${rule.courseKey} (${t("training.courseNotUploaded")})`} · {t("training.minScore", { percent: rule.minScorePercent })}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        );
    }

    const update = (index: number, patch: Partial<(typeof rows)[number]>) => {
        setSaved(false);
        setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    };

    return (
        <Card className="max-w-5xl p-5">
            <Form
                busy={action.busy}
                canSubmit={rows.every((row) => row.courseKey.trim() !== "" && row.minScorePercent !== "")}
                onSubmit={async () => {
                    setSaved(false);
                    const ok = await action.run(async () =>
                        api("/api/training/admission-rules", {
                            method: "PUT",
                            body: { rules: rows.map((row) => ({ branchId: row.branchId || null, courseKey: row.courseKey.trim().toLowerCase(), minScorePercent: Number(row.minScorePercent) })) },
                        })
                    );
                    if (ok) {
                        setSaved(true);
                        onSaved();
                    }
                }}
            >
                <p className="text-sm text-muted-foreground">{t("training.rulesHint")}</p>
                {initial.source === "config" ? <FormMessage kind="info">{t("training.rulesSourceConfig")}</FormMessage> : null}
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                {saved ? <FormMessage kind="success">{t("training.rulesSaved")}</FormMessage> : null}
                {rows.length === 0 ? <p className="text-sm">{t("training.rulesEmpty")}</p> : null}
                <datalist id="course-keys">
                    {catalog.data?.courses.map((course) => (
                        <option key={course.key} value={course.key}>
                            {course.title}
                        </option>
                    ))}
                </datalist>
                {rows.map((row, index) => (
                    <fieldset key={index} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_7rem_auto] sm:items-end">
                        <legend className="sr-only">{`${t("training.rules")} ${index + 1}`}</legend>
                        <Field label={t("common.branch")}>
                            <Select value={row.branchId} onChange={(event) => update(index, { branchId: event.target.value })}>
                                <option value="">{t("common.allBranches")}</option>
                                {me.branches.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={t("training.ruleCourse")} hint={row.courseKey && catalog.data && !knownKeys.has(row.courseKey.trim().toLowerCase()) ? t("training.courseNotUploaded") : undefined}>
                            <Input list="course-keys" value={row.courseKey} spellCheck={false} autoCapitalize="none" onChange={(event) => update(index, { courseKey: event.target.value })} />
                        </Field>
                        <Field label={t("training.ruleMin")}>
                            <Input type="number" inputMode="numeric" min={1} max={100} value={row.minScorePercent} onChange={(event) => update(index, { minScorePercent: event.target.value })} />
                        </Field>
                        <Button variant="danger" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                            {t("training.remove")}
                        </Button>
                    </fieldset>
                ))}
                <div>
                    <Button variant="secondary" onClick={() => setRows((current) => [...current, { branchId: "", courseKey: "", minScorePercent: "80" }])}>
                        {t("training.addRule")}
                    </Button>
                </div>
            </Form>
        </Card>
    );
}
