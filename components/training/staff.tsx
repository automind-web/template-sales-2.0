"use client";

import { useState } from "react";
import { formatDateTime, t } from "../../i18n/index.ts";
import { api, ApiError, errorMessage } from "../../lib/api.ts";
import { useApiData } from "../../lib/use-api.ts";
import { useSession } from "../session.tsx";
import { Button } from "../ui/button.tsx";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Spinner } from "../ui/card.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { ErrorRetry } from "../ui/error-retry.tsx";
import { Field, FormMessage } from "../ui/field.tsx";
import { Form } from "../ui/form.tsx";
import { Input, Select } from "../ui/input.tsx";
import { AdmissionRulesStatus } from "./my-courses.tsx";
import { ProgressBar } from "./progress-bar.tsx";
import type { RuleStatus } from "./types.ts";

function useBranchQuery() {
    const { me } = useSession();
    return me.user.role === "director" && me.selectedBranchId ? `?branchId=${encodeURIComponent(me.selectedBranchId)}` : "";
}

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

export function TeamProgress() {
    const { me } = useSession();
    const query = useBranchQuery();
    const data = useApiData(`training-progress${query}`, (signal) => api<{ employees: ProgressRow[] }>(`/api/training/progress${query}`, { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    if (data.data.employees.length === 0) {
        return (
            <Card>
                <EmptyState title={t("training.noEmployees")} />
            </Card>
        );
    }
    return (
        <Card aria-busy={data.loading} className={data.loading ? "opacity-60" : undefined}>
            <ul className="divide-y divide-border">
                {data.data.employees.map((person) => (
                    <li key={person.id} className="grid gap-2 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="font-medium break-anywhere">{person.displayName}</div>
                                <div className="text-xs text-muted-foreground break-anywhere">
                                    {person.login}
                                    {person.branchName ? ` · ${person.branchName}` : ""}
                                </div>
                            </div>
                            <Badge tone={person.admitted ? "primary" : "warning"}>{person.admitted ? t("team.admitted") : t("team.notAdmitted")}</Badge>
                        </div>
                        {person.courses.length === 0 ? (
                            <p className="text-xs text-muted-foreground">{t("training.noAssignedCourses")}</p>
                        ) : (
                            <div className="grid gap-2 md:grid-cols-2">
                                {person.courses.map((course) => (
                                    <div key={course.courseId} className="grid gap-1.5 rounded-md border border-border p-2">
                                        <div className="flex flex-wrap items-center justify-between gap-1">
                                            <span className="font-medium break-anywhere">{course.title}</span>
                                            <span className="flex gap-1">
                                                {course.inProgress ? <Badge tone="warning">{t("training.inProgress")}</Badge> : null}
                                                {course.bestPercent !== null ? (
                                                    <Badge tone={course.passed ? "success" : "danger"}>{course.passed ? t("training.passed") : t("training.notPassed")}</Badge>
                                                ) : (
                                                    <Badge>{t("training.noAttempts")}</Badge>
                                                )}
                                            </span>
                                        </div>
                                        <ProgressBar percent={course.lessons.percent} label={t("training.lessonsProgress", { done: course.lessons.completed, total: course.lessons.total })} />
                                        <p className="text-xs text-muted-foreground">
                                            {t("training.attempts", { count: course.attempts })} · {t("training.minScore", { percent: course.minScorePercent })}
                                            {course.bestPercent !== null ? ` · ${t("training.bestScore", { percent: course.bestPercent })}` : ""}
                                            {course.lastPercent !== null && course.lastVersion !== null ? ` · ${t("training.lastResult", { percent: course.lastPercent, version: course.lastVersion })}` : ""}
                                            {course.lastSubmittedAt ? ` · ${formatDateTime(course.lastSubmittedAt, me.company.timezone)}` : ""}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                        {!person.admitted && person.rules.length > 0 ? (
                            <div className="text-xs">
                                <AdmissionRulesStatus rules={person.rules} />
                            </div>
                        ) : null}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

// --- Каталог курсов ------------------------------------------------------

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

export function Catalog() {
    const { me } = useSession();
    const data = useCatalog();
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    if (data.data.courses.length === 0) {
        return (
            <Card>
                <EmptyState title={t("training.catalogEmpty")} />
            </Card>
        );
    }
    return (
        <div className="grid gap-3">
            {data.data.courses.map((course) => (
                <Card key={course.id}>
                    <CardHeader>
                        <CardTitle>{course.title}</CardTitle>
                        <span className="font-mono text-xs text-muted-foreground">{course.key}</span>
                    </CardHeader>
                    <CardContent>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("training.versionsHistory")}</p>
                        <ul className="grid gap-1 text-sm">
                            {course.versions.map((version, index) => (
                                <li key={version.id} className="flex flex-wrap items-center gap-2">
                                    {index === 0 ? <Badge tone="primary">{t("training.version", { version: version.version })}</Badge> : <Badge>{t("training.version", { version: version.version })}</Badge>}
                                    <span className="text-xs text-muted-foreground break-anywhere">
                                        {t("training.versionRow", { version: version.version, lessons: version.lessons, questions: version.questions, pass: version.passPercent })} · {formatDateTime(version.createdAt, me.company.timezone)}
                                        {version.externalRef ? ` · ${version.externalRef}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ))}
        </div>
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

    const scopeLabel = (row: Assignment) =>
        row.scope === "company" ? t("training.scope.company") : row.scope === "branch" ? `${t("training.scope.branch")}: ${row.branchName ?? ""}` : `${row.userName ?? ""}`;

    return (
        <div className="grid gap-3">
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
                    <EmptyState title={t("training.assignmentsEmpty")} />
                </Card>
            ) : (
                <Card>
                    <ul className="divide-y divide-border">
                        {data.data.assignments.map((row) => (
                            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium break-anywhere">{row.courseTitle}</div>
                                    <div className="text-xs text-muted-foreground break-anywhere">
                                        {scopeLabel(row)} · {formatDateTime(row.createdAt, me.company.timezone)}
                                    </div>
                                </div>
                                {row.canRemove ? (
                                    <Button variant="danger-ghost" size="sm" onClick={() => void remove(row.id)}>
                                        {t("training.remove")}
                                    </Button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </Card>
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
    const people = useApiData(`assign-users${query}`, (signal) => api<{ users: Array<{ id: string; displayName: string; role: string; branchName: string | null }> }>(`/api/users${query}`, { signal }));
    const defaultBranch = me.selectedBranchId && me.selectedBranchId !== "*" ? me.selectedBranchId : (me.branches[0]?.id ?? "");
    const [courseId, setCourseId] = useState("");
    const [scope, setScope] = useState<"company" | "branch" | "user">("branch");
    const [branchId, setBranchId] = useState(defaultBranch);
    const [userId, setUserId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    const courseOptions = catalog.data?.courses.filter((course) => !course.archived && course.versions.length > 0) ?? [];
    const selectedCourse = courseId || courseOptions[0]?.id || "";
    const userOptions = (people.data?.users ?? []).filter((user) => user.id !== me.user.id);
    const selectedUser = userId || userOptions[0]?.id || "";

    async function submit() {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            await api("/api/training/assignments", { method: "POST", body: { courseId: selectedCourse, scope, branchId, userId: selectedUser } });
            onSaved();
            onClose();
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
            setBusy(false);
        }
    }

    return (
        <Dialog open onClose={onClose} title={t("training.assignTitle")}>
            <Form
                onSubmit={submit}
                busy={busy}
                canSubmit={selectedCourse !== "" && (scope !== "user" || selectedUser !== "") && (scope !== "branch" || !isDirector || branchId !== "")}
                submitLabel={t("training.assign")}
                secondary={
                    <Button variant="ghost" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
            >
                {error ? <FormMessage kind="error">{error}</FormMessage> : null}
                {catalog.data && courseOptions.length === 0 ? <FormMessage kind="info">{t("training.catalogEmpty")}</FormMessage> : null}
                <Field label={t("training.course")} error={fields["courseId"]}>
                    <Select value={selectedCourse} onChange={(event) => setCourseId(event.target.value)} data-autofocus>
                        {courseOptions.map((course) => (
                            <option key={course.id} value={course.id}>
                                {course.title}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={t("training.assignScope")} error={fields["scope"]}>
                    <Select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
                        {isDirector ? <option value="company">{t("training.scope.company")}</option> : null}
                        <option value="branch">{t("training.scope.branch")}</option>
                        <option value="user">{t("training.scope.user")}</option>
                    </Select>
                </Field>
                {scope === "branch" && isDirector ? (
                    <Field label={t("common.branch")} error={fields["branchId"]}>
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
                    <Field label={t("training.employee")} error={fields["userId"]}>
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
            </Form>
        </Dialog>
    );
}

// --- Правила допуска -----------------------------------------------------

type RuleRow = { branchId: string | null; courseKey: string; minScorePercent: number; courseTitle: string | null };

export function AdmissionRulesEditor() {
    const data = useApiData("training-rules", (signal) => api<{ source: "config" | "company"; canEdit: boolean; rules: RuleRow[] }>("/api/training/admission-rules", { signal }));
    if (data.error && !data.data) return <ErrorRetry message={data.error} onRetry={data.reload} />;
    if (!data.data) return <Spinner label={t("common.loading")} />;
    // Форма создаётся один раз: после сохранения строки уже совпадают с сохранёнными, а сообщение не теряется.
    return <RulesForm initial={data.data} onSaved={data.reload} />;
}

function RulesForm({ initial, onSaved }: { initial: { source: "config" | "company"; canEdit: boolean; rules: RuleRow[] }; onSaved: () => void }) {
    const { me } = useSession();
    const catalog = useCatalog();
    const [rows, setRows] = useState(initial.rules.map((rule) => ({ branchId: rule.branchId ?? "", courseKey: rule.courseKey, minScorePercent: String(rule.minScorePercent) })));
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
    const branchName = (id: string | null) => (id ? (me.branches.find((branch) => branch.id === id)?.name ?? id) : t("common.allBranches"));
    const knownKeys = new Set(catalog.data?.courses.map((course) => course.key) ?? []);

    if (!initial.canEdit) {
        return (
            <Card>
                <CardContent className="grid gap-2 text-sm">
                    <p className="text-muted-foreground">{t("training.rulesHint")}</p>
                    {initial.rules.length === 0 ? (
                        <p>{t("training.rulesEmpty")}</p>
                    ) : (
                        <ul className="grid gap-1">
                            {initial.rules.map((rule, index) => (
                                <li key={index} className="break-anywhere">
                                    {branchName(rule.branchId)} · {t("role.employee")} · {rule.courseTitle ?? `${rule.courseKey} (${t("training.courseNotUploaded")})`} · {t("training.minScore", { percent: rule.minScorePercent })}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        );
    }

    async function save() {
        setBusy(true);
        setMessage(null);
        try {
            await api("/api/training/admission-rules", {
                method: "PUT",
                body: { rules: rows.map((row) => ({ branchId: row.branchId || null, courseKey: row.courseKey.trim().toLowerCase(), minScorePercent: Number(row.minScorePercent) })) },
            });
            setMessage({ kind: "success", text: t("training.rulesSaved") });
            onSaved();
        } catch (caught) {
            setMessage({ kind: "error", text: errorMessage(caught) });
        } finally {
            setBusy(false);
        }
    }

    const update = (index: number, patch: Partial<(typeof rows)[number]>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

    return (
        <Card>
            <CardContent>
                <Form onSubmit={save} busy={busy} canSubmit={rows.every((row) => row.courseKey.trim() !== "" && row.minScorePercent !== "")}>
                    <p className="text-sm text-muted-foreground">{t("training.rulesHint")}</p>
                    {initial.source === "config" ? <FormMessage kind="info">{t("training.rulesSourceConfig")}</FormMessage> : null}
                    {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
                    {rows.length === 0 ? <p className="text-sm">{t("training.rulesEmpty")}</p> : null}
                    <datalist id="course-keys">
                        {catalog.data?.courses.map((course) => (
                            <option key={course.key} value={course.key}>
                                {course.title}
                            </option>
                        ))}
                    </datalist>
                    {rows.map((row, index) => (
                        <fieldset key={index} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_6rem_auto] sm:items-end">
                            <legend className="sr-only">{`${t("training.rules")} ${index + 1}`}</legend>
                            <Field label={t("training.ruleRole")}>
                                <Select value="employee" disabled>
                                    <option value="employee">{t("role.employee")}</option>
                                </Select>
                            </Field>
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
                            <Button variant="danger-ghost" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
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
            </CardContent>
        </Card>
    );
}
