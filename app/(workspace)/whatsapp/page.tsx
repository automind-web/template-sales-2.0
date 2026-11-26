"use client";

import { BookOpen, Bot, CheckCheck, MessageCircle, RefreshCw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Page, SectionGate } from "../../../components/app-shell.tsx";
import { useSession } from "../../../components/session.tsx";
import { StatusPill, Tag, type Tone } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Card, EmptyState, Section, Spinner } from "../../../components/ui/card.tsx";
import { Dialog } from "../../../components/ui/dialog.tsx";
import { ErrorRetry } from "../../../components/ui/error-retry.tsx";
import { Field, FormMessage } from "../../../components/ui/field.tsx";
import { Form } from "../../../components/ui/form.tsx";
import { Input, Select, Textarea } from "../../../components/ui/input.tsx";
import { Table, Td, Th, THead, Tr } from "../../../components/ui/table.tsx";
import { Tabs, useTab, type TabItem } from "../../../components/ui/tabs.tsx";
import { useToast } from "../../../components/ui/toast.tsx";
import { formatShort, t, type MessageKey } from "../../../i18n/index.ts";
import { api, errorMessage } from "../../../lib/api.ts";
import { useAction } from "../../../lib/use-action.ts";
import { useApiData } from "../../../lib/use-api.ts";
import { cn } from "../../../lib/utils.ts";

type Studio = {
    branch: { id: string; name: string } | null;
    base: { name: string; instructions: string };
    agent: { id: string; name: string; instructions: string; updatedAt: number; lastTest: { at: number; ok: boolean; mode: "model" | "offline"; error: string | null } | null } | null;
    materials: Array<{ id: string; title: string; body: string; source: "text" | "course"; length: number; createdAt: number }>;
    channel: { status: "connected" | "disconnected"; phone: string | null; connectedAt: number | null; lastCheckAt: number | null; lastCheckState: string | null; lastCheckDetail: string | null; lastInboundAt: number | null } | null;
    secrets: { whapi: boolean; model: boolean };
    model: string;
    messages: Array<{ id: string; chatId: string; direction: "in" | "out"; text: string; status: "received" | "pending" | "sent" | "failed"; error: string | null; attempts: number; leadId: string | null; createdAt: number; failed: boolean }>;
    outbox: Record<string, number>;
    courses: Array<{ id: string; title: string }>;
};

type TabKey = "agent" | "channel" | "log";
const TABS: ReadonlyArray<TabItem<TabKey>> = [
    { key: "agent", label: t("wa.tab.agent") },
    { key: "channel", label: t("wa.tab.channel") },
    { key: "log", label: t("wa.tab.log") },
];

export default function WhatsAppPage() {
    return (
        <SectionGate section="whatsapp" title={t("wa.title")}>
            <WhatsApp />
        </SectionGate>
    );
}

function WhatsApp() {
    const { me } = useSession();
    const branchId = me.user.role === "director" ? me.selectedBranchId : me.user.branchId;
    if (!branchId || branchId === "*") {
        return (
            <Page title={t("wa.title")}>
                <Card>
                    <EmptyState icon={MessageCircle} title={t("crm.selectBranch")}>
                        {t("wa.selectBranch")}
                    </EmptyState>
                </Card>
            </Page>
        );
    }
    return <StudioView key={branchId} branchId={branchId} />;
}

/** Запрос к студии: филиал всегда передаётся явно, ответ — новое состояние экрана */
function useStudio(branchId: string) {
    const data = useApiData(`wa-studio-${branchId}`, (signal) => api<Studio>(`/api/whatsapp/studio?branchId=${encodeURIComponent(branchId)}`, { signal }));
    const [fresh, setFresh] = useState<{ base: Studio | null; value: Studio } | null>(null);
    const studio = fresh && fresh.base === data.data ? fresh.value : data.data;
    const mutate = async (method: "POST" | "PATCH" | "DELETE", path: string, body: Record<string, unknown> = {}) => {
        const result = await api<Studio>(path, { method, body: { ...body, branchId } });
        setFresh({ base: data.data, value: result });
        return result;
    };
    return { data, studio, mutate };
}

function StudioView({ branchId }: { branchId: string }) {
    const [tab, setTab] = useTab(TABS);
    const { data, studio, mutate } = useStudio(branchId);
    const toast = useToast();

    return (
        <Page title={t("wa.title")}>
            <Tabs items={TABS} value={tab} onChange={setTab} label={t("wa.title")} />
            {data.error && !studio ? (
                <ErrorRetry message={data.error} onRetry={data.reload} />
            ) : !studio ? (
                <Spinner label={t("common.loading")} />
            ) : tab === "agent" ? (
                studio.agent ? (
                    <AgentTab studio={studio} branchId={branchId} mutate={mutate} notify={toast.show} onTested={data.reload} />
                ) : (
                    <NoAgent mutate={mutate} />
                )
            ) : tab === "channel" ? (
                <ChannelTab studio={studio} mutate={mutate} notify={toast.show} />
            ) : (
                <LogTab studio={studio} mutate={mutate} notify={toast.show} />
            )}
            <p className="mt-4 text-[13px] text-muted-foreground">{t("wa.secretsNote")}</p>
            {toast.view}
        </Page>
    );
}

type Mutate = ReturnType<typeof useStudio>["mutate"];
type Notify = ReturnType<typeof useToast>["show"];

function NoAgent({ mutate }: { mutate: Mutate }) {
    const action = useAction();
    return (
        <Card>
            <EmptyState icon={Bot} title={t("wa.noAgentTitle")}>
                <div className="grid justify-items-center gap-3">
                    <p className="max-w-xl">{t("wa.noAgentText")}</p>
                    <Button disabled={action.busy} onClick={() => void action.run(async () => void (await mutate("POST", "/api/whatsapp/agent")))}>
                        {t("wa.createAgent")}
                    </Button>
                    {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                </div>
            </EmptyState>
        </Card>
    );
}

// --- Агент ---------------------------------------------------------------

function AgentTab({ studio, branchId, mutate, notify, onTested }: { studio: Studio; branchId: string; mutate: Mutate; notify: Notify; onTested: () => void }) {
    const agent = studio.agent!;
    return (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
            <div className="grid gap-4">
                <AgentForm key={agent.updatedAt} studio={studio} mutate={mutate} notify={notify} />
                <Materials studio={studio} mutate={mutate} />
            </div>
            <TestChat key={branchId} branchId={branchId} name={agent.name} onTested={onTested} />
        </div>
    );
}

function AgentForm({ studio, mutate, notify }: { studio: Studio; mutate: Mutate; notify: Notify }) {
    const agent = studio.agent!;
    const [name, setName] = useState(agent.name);
    const [instructions, setInstructions] = useState(agent.instructions);
    const action = useAction();
    const changed = name.trim() !== agent.name || instructions.trim() !== agent.instructions;
    const test = agent.lastTest;
    return (
        <Section title={t("wa.agentCard")} action={<StatusPill tone={studio.secrets.model ? "success" : "warning"}>{studio.secrets.model ? t("wa.modeModel") : t("wa.modeOffline")}</StatusPill>}>
            <Form
                canSubmit={changed && Boolean(name.trim()) && Boolean(instructions.trim())}
                busy={action.busy}
                submitLabel={t("wa.saveAgent")}
                onSubmit={() =>
                    action.run(async () => {
                        await mutate("PATCH", "/api/whatsapp/agent", { name, instructions });
                        notify({ kind: "success", text: t("wa.saved") });
                    })
                }
            >
                <Field label={t("wa.agentName")} error={action.fields["name"] ? t(action.fields["name"] as MessageKey) : undefined}>
                    <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label={t("wa.instructions")} hint={t("wa.instructionsHint")} error={action.fields["instructions"] ? t(action.fields["instructions"] as MessageKey) : undefined}>
                    <Textarea rows={5} value={instructions} maxLength={4000} onChange={(event) => setInstructions(event.target.value)} />
                </Field>
                <dl className="grid gap-3 rounded-xl bg-muted/60 p-4 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("wa.model")}</dt>
                        <dd className="mt-1 font-semibold">{studio.model}</dd>
                        <dd className="text-[13px] text-muted-foreground">{t("wa.modelHint")}</dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("wa.lastTest")}</dt>
                        <dd className="mt-1">
                            {test ? (
                                <StatusPill tone={test.ok ? "success" : "danger"}>{t(test.ok ? "wa.lastTestOk" : "wa.lastTestFail", { date: formatShort(test.at) })}</StatusPill>
                            ) : (
                                <span className="text-muted-foreground">{t("wa.lastTestNever")}</span>
                            )}
                        </dd>
                    </div>
                </dl>
                {!studio.secrets.model ? <FormMessage kind="info">{t("wa.modelKeyMissing")}</FormMessage> : null}
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            </Form>
        </Section>
    );
}

function Materials({ studio, mutate }: { studio: Studio; mutate: Mutate }) {
    const [dialog, setDialog] = useState<"text" | "course" | null>(null);
    const [removing, setRemoving] = useState<Studio["materials"][number] | null>(null);
    return (
        <Section
            title={`${t("wa.materials")} · ${studio.materials.length}`}
            action={
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setDialog("text")}>
                        {t("wa.addText")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setDialog("course")}>
                        <BookOpen className="size-4" />
                        {t("wa.importCourse")}
                    </Button>
                </div>
            }
        >
            {studio.materials.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("wa.materialsEmpty")}</p>
            ) : (
                <ul className="grid gap-2">
                    {studio.materials.map((item) => (
                        <li key={item.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="break-anywhere">{item.title}</strong>
                                    <Tag>{t(item.source === "course" ? "wa.source.course" : "wa.source.text")}</Tag>
                                    <span className="text-[13px] text-muted-foreground">{t("wa.chars", { count: item.length })}</span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground break-anywhere">{item.body.replace(/\s+/g, " ")}</p>
                            </div>
                            <button type="button" onClick={() => setRemoving(item)} className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground/60 hover:bg-muted hover:text-danger" aria-label={`${t("wa.deleteMaterial")}: ${item.title}`}>
                                <Trash2 className="size-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {dialog === "text" ? <TextMaterialDialog mutate={mutate} onClose={() => setDialog(null)} /> : null}
            {dialog === "course" ? <CourseMaterialDialog courses={studio.courses} mutate={mutate} onClose={() => setDialog(null)} /> : null}
            {removing ? (
                <ConfirmDialog
                    title={t("wa.deleteMaterial")}
                    text={t("wa.deleteConfirm", { title: removing.title })}
                    confirmLabel={t("wa.deleteMaterial")}
                    onClose={() => setRemoving(null)}
                    onConfirm={() => mutate("DELETE", `/api/whatsapp/materials/${removing.id}`)}
                />
            ) : null}
        </Section>
    );
}

function TextMaterialDialog({ mutate, onClose }: { mutate: Mutate; onClose: () => void }) {
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const action = useAction();
    return (
        <Dialog open onClose={onClose} title={t("wa.addText")}>
            <Form
                variant="dialog"
                canSubmit={Boolean(title.trim() && body.trim())}
                busy={action.busy}
                submitLabel={t("wa.addMaterial")}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    action.run(async () => {
                        await mutate("POST", "/api/whatsapp/materials", { title, body });
                        onClose();
                    })
                }
            >
                <Field label={t("wa.materialTitle")}>
                    <Input data-autofocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
                </Field>
                <Field label={t("wa.materialBody")}>
                    <Textarea rows={8} value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
                </Field>
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            </Form>
        </Dialog>
    );
}

function CourseMaterialDialog({ courses, mutate, onClose }: { courses: Studio["courses"]; mutate: Mutate; onClose: () => void }) {
    const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
    const action = useAction();
    return (
        <Dialog open onClose={onClose} title={t("wa.importCourse")} description={t("wa.courseImportHint")}>
            <Form
                variant="dialog"
                canSubmit={Boolean(courseId)}
                busy={action.busy}
                submitLabel={t("wa.addMaterial")}
                secondary={
                    <Button variant="secondary" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    action.run(async () => {
                        await mutate("POST", "/api/whatsapp/materials", { courseId });
                        onClose();
                    })
                }
            >
                {courses.length === 0 ? (
                    <FormMessage kind="info">{t("wa.courseEmpty")}</FormMessage>
                ) : (
                    <Field label={t("wa.courseSelect")}>
                        <Select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                            {courses.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.title}
                                </option>
                            ))}
                        </Select>
                    </Field>
                )}
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            </Form>
        </Dialog>
    );
}

function ConfirmDialog({ title, text, confirmLabel, onClose, onConfirm }: { title: string; text: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<unknown> }) {
    const action = useAction();
    return (
        <Dialog open onClose={onClose} title={title}>
            <Form
                variant="dialog"
                busy={action.busy}
                submitLabel={confirmLabel}
                secondary={
                    <Button variant="secondary" onClick={onClose} data-autofocus>
                        {t("common.cancel")}
                    </Button>
                }
                onSubmit={() =>
                    action.run(async () => {
                        await onConfirm();
                        onClose();
                    })
                }
            >
                <p className="text-sm">{text}</p>
                {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
            </Form>
        </Dialog>
    );
}

/** Тестовый диалог в виде чата WhatsApp: тот же агент и материалы, ничего не отправляется */
function TestChat({ branchId, name, onTested }: { branchId: string; name: string; onTested: () => void }) {
    type Line = { role: "user" | "assistant"; text: string; at: number; mode?: "model" | "offline" };
    const [lines, setLines] = useState<Line[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }, [lines, busy]);

    async function send() {
        const question = draft.trim();
        if (!question || busy) return;
        const history = lines.map((line) => ({ role: line.role, text: line.text }));
        setLines((current) => [...current, { role: "user", text: question, at: Date.now() }]);
        setDraft("");
        setBusy(true);
        setError(null);
        try {
            const result = await api<{ reply: string; mode: "model" | "offline"; at: number }>("/api/whatsapp/test", { method: "POST", body: { branchId, question, history } });
            setLines((current) => [...current, { role: "assistant", text: result.reply, at: result.at, mode: result.mode }]);
            onTested();
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setBusy(false);
        }
    }

    const time = (at: number) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));

    return (
        <Card className="overflow-hidden p-0 xl:sticky xl:top-4">
            <div className="flex items-center gap-3 bg-[#0b5e54] px-4 py-3 text-white">
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-white/20">
                    <Bot className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="font-bold break-anywhere">{name}</div>
                    <div className="text-[13px] text-white/80">{busy ? t("wa.typing") : t("wa.test")}</div>
                </div>
                {lines.length ? (
                    <button type="button" onClick={() => setLines([])} className="cursor-pointer rounded-lg px-2 py-1 text-[13px] font-semibold text-white/90 hover:bg-white/15">
                        {t("wa.testClear")}
                    </button>
                ) : null}
            </div>
            <div ref={scroller} className="grid h-[420px] content-start gap-2 overflow-y-auto bg-[#efeae2] p-4" aria-live="polite" aria-label={t("wa.test")}>
                {lines.length === 0 ? <p className="mx-auto mt-6 max-w-xs rounded-lg bg-[#fff6c8] px-3 py-2 text-center text-[13px] text-[#54656f]">{t("wa.testHint")} {t("wa.testEmpty")}</p> : null}
                {lines.map((line, index) => (
                    <div key={index} className={cn("flex", line.role === "user" ? "justify-start" : "justify-end")}>
                        <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[15px] text-[#111b21] shadow-sm", line.role === "user" ? "rounded-tl-none bg-white" : "rounded-tr-none bg-[#d9fdd3]")}>
                            <span className="sr-only">{line.role === "user" ? t("wa.you") : name}: </span>
                            <p className="whitespace-pre-line break-anywhere">{line.text}</p>
                            <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#667781]">
                                {line.mode === "offline" ? <span>{t("wa.modeOffline").split(":")[0]}</span> : null}
                                <span>{time(line.at)}</span>
                                {line.role === "assistant" ? <CheckCheck className="size-3.5 text-[#53bdeb]" aria-hidden /> : null}
                            </div>
                        </div>
                    </div>
                ))}
                {busy ? (
                    <div className="flex justify-end">
                        <div className="rounded-lg bg-[#d9fdd3] px-3 py-2 text-[13px] text-[#667781]">{t("wa.typing")}</div>
                    </div>
                ) : null}
            </div>
            {error ? (
                <div className="border-t border-border px-4 py-2">
                    <FormMessage kind="error">{error}</FormMessage>
                </div>
            ) : null}
            <form
                className="flex items-center gap-2 bg-[#f0f2f5] p-3"
                onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                }}
            >
                <Input aria-label={t("wa.testPlaceholder")} placeholder={t("wa.testPlaceholder")} value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} className="rounded-full bg-white" />
                <button type="submit" disabled={!draft.trim() || busy} className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#00a884] text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label={t("wa.testSend")}>
                    <Send className="size-5" />
                </button>
            </form>
        </Card>
    );
}

// --- Рабочий номер -------------------------------------------------------

const STATE_TONE: Record<string, Tone> = { connected: "success", qr: "warning", starting: "warning", unauthorized: "danger", unavailable: "danger", not_configured: "danger" };

function ChannelTab({ studio, mutate, notify }: { studio: Studio; mutate: Mutate; notify: Notify }) {
    const channel = studio.channel;
    const connected = channel?.status === "connected";
    const [phone, setPhone] = useState(channel?.phone ?? "");
    const [confirm, setConfirm] = useState(false);
    const action = useAction();
    const state = !studio.secrets.whapi ? "not_configured" : (channel?.lastCheckState ?? null);
    const run = (path: string, body: Record<string, unknown> = {}, done?: string) =>
        action.run(async () => {
            await mutate("POST", path, body);
            if (done) notify({ kind: "success", text: done });
        });

    return (
        <div className="grid max-w-5xl gap-4">
            <Section title={t("wa.channel")} action={<StatusPill tone={connected ? "success" : "neutral"}>{t(connected ? "wa.status.connected" : channel ? "wa.status.disconnected" : "wa.status.none")}</StatusPill>}>
                <div className="grid gap-4">
                    <p className="text-sm text-muted-foreground">{t("wa.channelHint")}</p>
                    {state ? (
                        <div className={cn("grid gap-1.5 rounded-xl border p-4", state === "connected" ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")}>
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusPill tone={STATE_TONE[state] ?? "neutral"}>{t(`wa.state.${state}` as MessageKey)}</StatusPill>
                                {channel?.lastCheckAt ? <span className="text-[13px] text-muted-foreground">{t("wa.lastCheck", { date: formatShort(channel.lastCheckAt) })}</span> : null}
                                {channel?.lastCheckDetail && state !== "connected" ? <span className="text-[13px] text-muted-foreground">({channel.lastCheckDetail})</span> : null}
                            </div>
                            <p className="text-sm">{t(`wa.fix.${state}` as MessageKey)}</p>
                        </div>
                    ) : null}
                    {channel ? (
                        <dl className="grid gap-3 text-sm sm:grid-cols-3">
                            <div>
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("wa.phone")}</dt>
                                <dd className="mt-1 font-semibold">{channel.phone ?? "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("wa.status.connected")}</dt>
                                <dd className="mt-1">{channel.connectedAt ? formatShort(channel.connectedAt) : "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("wa.log.direction")}</dt>
                                <dd className="mt-1">{channel.lastInboundAt ? t("wa.lastInbound", { date: formatShort(channel.lastInboundAt) }) : t("wa.noInbound")}</dd>
                            </div>
                        </dl>
                    ) : null}
                    <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void run("/api/whatsapp/channel/connect", { phone }, t("wa.saved"));
                        }}
                    >
                        <Field label={t("wa.phone")} optional className="w-full sm:w-80">
                            <Input inputMode="tel" placeholder="+7 700 000 00 00" value={phone} maxLength={20} onChange={(event) => setPhone(event.target.value)} />
                        </Field>
                        <Button type="submit" disabled={action.busy || !studio.secrets.whapi}>
                            {t(connected ? "wa.reconnect" : "wa.connect")}
                        </Button>
                        {channel ? (
                            <Button variant="secondary" disabled={action.busy} onClick={() => void run("/api/whatsapp/channel/check")}>
                                <RefreshCw className="size-4" />
                                {t("wa.check")}
                            </Button>
                        ) : null}
                        {connected ? (
                            <Button variant="danger" disabled={action.busy} onClick={() => setConfirm(true)}>
                                {t("wa.disconnect")}
                            </Button>
                        ) : null}
                    </form>
                    {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
                </div>
            </Section>
            <Outbox studio={studio} mutate={mutate} notify={notify} />
            {confirm ? <ConfirmDialog title={t("wa.disconnect")} text={t("wa.disconnectConfirm")} confirmLabel={t("wa.disconnect")} onClose={() => setConfirm(false)} onConfirm={() => mutate("POST", "/api/whatsapp/channel/disconnect")} /> : null}
        </div>
    );
}

function Outbox({ studio, mutate, notify }: { studio: Studio; mutate: Mutate; notify: Notify }) {
    const action = useAction();
    const failed = studio.outbox["failed"] ?? 0;
    return (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">{t("wa.outbox", { sent: studio.outbox["sent"] ?? 0, pending: studio.outbox["pending"] ?? 0, failed })}</p>
            {failed > 0 ? (
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={action.busy}
                    onClick={() =>
                        void action.run(async () => {
                            const result = (await mutate("POST", "/api/whatsapp/messages/retry")) as Studio & { sent?: number; failed?: number };
                            notify({ kind: result.failed ? "error" : "success", text: t("wa.retried", { sent: result.sent ?? 0, failed: result.failed ?? 0 }) });
                        })
                    }
                >
                    <RefreshCw className="size-4" />
                    {t("wa.retry")}
                </Button>
            ) : null}
            {action.error ? <FormMessage kind="error">{action.error}</FormMessage> : null}
        </Card>
    );
}

// --- Журнал --------------------------------------------------------------

const MESSAGE_TONE: Record<Studio["messages"][number]["status"], Tone> = { received: "info", pending: "warning", sent: "success", failed: "danger" };

function LogTab({ studio, mutate, notify }: { studio: Studio; mutate: Mutate; notify: Notify }) {
    if (studio.messages.length === 0) {
        return (
            <Card>
                <EmptyState icon={MessageCircle} title={t("wa.tab.log")}>
                    {t("wa.logEmpty")}
                </EmptyState>
            </Card>
        );
    }
    return (
        <div className="grid gap-4">
            <Outbox studio={studio} mutate={mutate} notify={notify} />
            <Table>
                <THead>
                    <tr>
                        <Th>{t("wa.log.time")}</Th>
                        <Th>{t("wa.log.chat")}</Th>
                        <Th>{t("wa.log.direction")}</Th>
                        <Th>{t("wa.log.text")}</Th>
                        <Th>{t("wa.log.status")}</Th>
                        <Th>{t("wa.log.lead")}</Th>
                    </tr>
                </THead>
                <tbody>
                    {studio.messages.map((message) => (
                        <Tr key={message.id}>
                            <Td className="whitespace-nowrap">{formatShort(message.createdAt)}</Td>
                            <Td className="whitespace-nowrap">+{message.chatId.split("@")[0]}</Td>
                            <Td className="whitespace-nowrap">{t(message.direction === "in" ? "wa.dir.in" : "wa.dir.out")}</Td>
                            <Td className="max-w-md">
                                <p className="line-clamp-3 break-anywhere">{message.text || "…"}</p>
                                {message.error ? <p className="text-[13px] text-danger">{message.error}</p> : null}
                            </Td>
                            <Td>
                                <StatusPill tone={MESSAGE_TONE[message.status]}>{t(`wa.msg.${message.status}` as MessageKey)}</StatusPill>
                            </Td>
                            <Td className="whitespace-nowrap">
                                {message.leadId ? (
                                    <Link href={`/crm/${message.leadId}`} className="font-semibold text-primary hover:underline">
                                        {t("wa.openLead")}
                                    </Link>
                                ) : (
                                    "—"
                                )}
                            </Td>
                        </Tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}
