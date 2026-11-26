/**
 * WhatsApp Studio: агент филиала, разрешённые материалы, тестовый диалог,
 * рабочий номер (Whapi) и webhook для входящих сообщений.
 */
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { branches, courses, waAgents, waChannels, waMaterials, waMessages } from "../../db/schema.ts";
import { requireSection, resolveBranchScope } from "../access.ts";
import { audit } from "../audit.ts";
import { requireActor, type Actor } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { randomToken, sha256Hex } from "../crypto.ts";
import { newId } from "../db.ts";
import { AppError, clientIp, readJson, str } from "../http.ts";
import { enforceRateLimit } from "../rate-limit.ts";
import { getSecret } from "../runtime.ts";
import { latestVersion, type CourseContent } from "../training.ts";
import { assistantModel } from "../crm/funnel.ts";
import { health, setWebhook } from "../whatsapp/whapi.ts";
import { acceptInbound, agentAnswer, baseAgent, deliver, MAX_ATTEMPTS, parseWebhook, retryPending } from "../whatsapp/service.ts";

const LIMITS = { name: 60, instructions: 4_000, title: 200, body: 20_000, materials: 50, question: 2_000 };

async function studioBranch(ctx: Ctx, actor: Actor, requested: string | null): Promise<string> {
    requireSection(actor, "whatsapp");
    const scope = await resolveBranchScope(ctx, actor, requested, { allowAll: false }).catch((error: unknown) => {
        if (error instanceof AppError && error.code === "shell.selectBranchForCrm") throw new AppError(400, "wa.selectBranch");
        throw error;
    });
    if (scope.kind !== "one") throw new AppError(400, "wa.selectBranch");
    return scope.branchId;
}

function bodyBranch(body: Record<string, unknown>): string | null {
    return typeof body["branchId"] === "string" ? body["branchId"] : null;
}

async function requireAgent(ctx: Ctx, branchId: string) {
    const agent = await ctx.db.select().from(waAgents).where(eq(waAgents.branchId, branchId)).get();
    if (!agent) throw new AppError(409, "wa.agentMissing");
    return agent;
}

/** Состояние канала для экрана: без секретов, только факты и способ восстановления */
function channelView(channel: typeof waChannels.$inferSelect | undefined) {
    if (!channel) return null;
    return {
        status: channel.status,
        phone: channel.phone,
        connectedAt: channel.connectedAt,
        lastCheckAt: channel.lastCheckAt,
        lastCheckState: channel.lastCheckState,
        lastCheckDetail: channel.lastCheckDetail,
        lastInboundAt: channel.lastInboundAt,
    };
}

export async function studio(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const branchId = await studioBranch(ctx, actor, ctx.url.searchParams.get("branchId"));
    const branch = await ctx.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId)).get();
    const agent = await ctx.db.select().from(waAgents).where(eq(waAgents.branchId, branchId)).get();
    const materials = agent
        ? await ctx.db
              .select({ id: waMaterials.id, title: waMaterials.title, body: waMaterials.body, source: waMaterials.source, createdAt: waMaterials.createdAt })
              .from(waMaterials)
              .where(eq(waMaterials.agentId, agent.id))
              .orderBy(waMaterials.createdAt)
              .all()
        : [];
    const channel = await ctx.db.select().from(waChannels).where(eq(waChannels.branchId, branchId)).get();
    const messages = await ctx.db
        .select({ id: waMessages.id, chatId: waMessages.chatId, direction: waMessages.direction, text: waMessages.text, status: waMessages.status, error: waMessages.error, attempts: waMessages.attempts, leadId: waMessages.leadId, createdAt: waMessages.createdAt })
        .from(waMessages)
        .where(eq(waMessages.branchId, branchId))
        .orderBy(desc(waMessages.createdAt))
        .limit(50)
        .all();
    const counts = await ctx.db
        .select({ status: waMessages.status, total: sql<number>`count(*)` })
        .from(waMessages)
        .where(and(eq(waMessages.branchId, branchId), eq(waMessages.direction, "out")))
        .groupBy(waMessages.status)
        .all();
    const courseList = await ctx.db.select({ id: courses.id, title: courses.title }).from(courses).where(and(eq(courses.companyId, actor.companyId), isNull(courses.archivedAt))).orderBy(courses.title).all();
    return {
        branch,
        base: baseAgent,
        agent: agent
            ? {
                  id: agent.id,
                  name: agent.name,
                  instructions: agent.instructions,
                  updatedAt: agent.updatedAt,
                  lastTest: agent.lastTestAt ? { at: agent.lastTestAt, ok: agent.lastTestOk === true, mode: agent.lastTestMode, error: agent.lastTestError } : null,
              }
            : null,
        materials: materials.map((item) => ({ ...item, body: item.body.slice(0, 400), length: item.body.length })),
        channel: channelView(channel),
        secrets: { whapi: getSecret(ctx.env, "WHAPI_TOKEN") !== null, model: getSecret(ctx.env, "OPENAI_API_KEY") !== null },
        model: await assistantModel(ctx.db, actor.companyId),
        messages: messages.map((item) => ({ ...item, failed: item.status === "failed" && item.attempts >= MAX_ATTEMPTS })),
        outbox: Object.fromEntries(counts.map((row) => [row.status, Number(row.total)])),
        courses: courseList,
    };
}

/** Агент филиала создаётся копией базового (config/company.ts) */
export async function createAgent(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const existing = await ctx.db.select({ id: waAgents.id }).from(waAgents).where(eq(waAgents.branchId, branchId)).get();
    if (!existing) {
        const id = newId();
        await ctx.env.DB
            .prepare("INSERT INTO wa_agents (id, company_id, branch_id, name, instructions, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(branch_id) DO NOTHING")
            .bind(id, actor.companyId, branchId, baseAgent.name, baseAgent.instructions, actor.userId, ctx.now, actor.userId, ctx.now)
            .run();
        await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.agent.create", entityType: "branch", entityId: branchId }, ctx.now);
    }
    return studio(withBranch(ctx, branchId));
}

/** studio() читает филиал из адреса — подставляем его после изменения */
function withBranch(ctx: Ctx, branchId: string): Ctx {
    const url = new URL(ctx.url);
    url.searchParams.set("branchId", branchId);
    return { ...ctx, url };
}

export async function updateAgent(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const agent = await requireAgent(ctx, branchId);
    const name = str(body, "name", { max: LIMITS.name });
    const instructions = str(body, "instructions", { max: LIMITS.instructions });
    await ctx.db.update(waAgents).set({ name, instructions, updatedBy: actor.userId, updatedAt: ctx.now }).where(eq(waAgents.id, agent.id));
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.agent.update", entityType: "branch", entityId: branchId }, ctx.now);
    return studio(withBranch(ctx, branchId));
}

/** Текст материала из курса: только уроки; ответы теста агенту не передаются */
export function courseText(content: CourseContent): string {
    return content.lessons
        .map((lesson) => `${lesson.title}\n\n${lesson.body}`.trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, LIMITS.body);
}

export async function addMaterial(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const agent = await requireAgent(ctx, branchId);
    const total = await ctx.db.select({ total: sql<number>`count(*)` }).from(waMaterials).where(eq(waMaterials.agentId, agent.id)).get();
    if (Number(total?.total ?? 0) >= LIMITS.materials) throw new AppError(400, "wa.materialsLimit", { vars: { limit: LIMITS.materials } });
    let title: string;
    let text: string;
    let source: "text" | "course" = "text";
    let sourceRef: string | null = null;
    if (typeof body["courseId"] === "string" && body["courseId"]) {
        const course = await ctx.db.select().from(courses).where(and(eq(courses.id, body["courseId"]), eq(courses.companyId, actor.companyId))).get();
        if (!course) throw new AppError(404, "training.courseNotFound");
        const version = await latestVersion(ctx.db, course.id);
        if (!version) throw new AppError(409, "wa.courseEmpty");
        title = `${version.title} (ред. ${version.version})`.slice(0, LIMITS.title);
        text = courseText(JSON.parse(version.content) as CourseContent);
        source = "course";
        sourceRef = version.id;
        if (!text) throw new AppError(409, "wa.courseEmpty");
    } else {
        title = str(body, "title", { max: LIMITS.title });
        text = str(body, "body", { max: LIMITS.body });
    }
    await ctx.db.insert(waMaterials).values({ id: newId(), agentId: agent.id, companyId: actor.companyId, title, body: text, source, sourceRef, createdBy: actor.userId, createdAt: ctx.now });
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.material.add", entityType: "branch", entityId: branchId, data: { source } }, ctx.now);
    return studio(withBranch(ctx, branchId));
}

export async function deleteMaterial(ctx: Ctx) {
    const actor = await requireActor(ctx);
    requireSection(actor, "whatsapp");
    const material = await ctx.db.select().from(waMaterials).where(and(eq(waMaterials.id, ctx.params["id"] ?? ""), eq(waMaterials.companyId, actor.companyId))).get();
    const agent = material ? await ctx.db.select().from(waAgents).where(eq(waAgents.id, material.agentId)).get() : undefined;
    if (!material || !agent) throw new AppError(404, "error.notFound");
    const branchId = await studioBranch(ctx, actor, agent.branchId);
    await ctx.db.delete(waMaterials).where(eq(waMaterials.id, material.id));
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.material.delete", entityType: "branch", entityId: branchId }, ctx.now);
    return studio(withBranch(ctx, branchId));
}

/** Тестовый диалог: тот же агент и те же материалы, что для клиентов; ничего не отправляется */
export async function testDialog(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const agent = await requireAgent(ctx, branchId);
    await enforceRateLimit(ctx.env.DB, `wa-test:${actor.userId}`, 30, 60_000, ctx.now, "wa.testRateLimited");
    const question = str(body, "question", { max: LIMITS.question });
    const history = Array.isArray(body["history"])
        ? (body["history"] as unknown[])
              .slice(-6)
              .map((item) => item as { role?: unknown; text?: unknown })
              .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
              .map((item) => ({ role: item.role as "user" | "assistant", text: String(item.text).slice(0, LIMITS.question) }))
        : [];
    const reply = await agentAnswer(ctx.env, ctx.db, branchId, question, history);
    if (!reply) throw new AppError(409, "wa.agentMissing");
    await ctx.db.update(waAgents).set({ lastTestAt: ctx.now, lastTestOk: reply.error === null, lastTestMode: reply.mode, lastTestError: reply.error ? reply.error.slice(0, 300) : null }).where(eq(waAgents.id, agent.id));
    return { reply: reply.text, mode: reply.mode, error: reply.error, at: ctx.now };
}

// --- Рабочий номер -------------------------------------------------------

function webhookUrl(ctx: Ctx, token: string): string {
    return `${ctx.url.origin}/api/whatsapp/webhook/${token}`;
}

async function checkChannel(ctx: Ctx, channelId: string) {
    const result = await health(getSecret(ctx.env, "WHAPI_TOKEN"));
    await ctx.db.update(waChannels).set({ lastCheckAt: ctx.now, lastCheckState: result.state, lastCheckDetail: result.detail?.slice(0, 200) ?? null }).where(eq(waChannels.id, channelId));
    return result;
}

/**
 * Подключение: новый секрет webhook (в БД — только хэш), адрес сохраняется в
 * настройках Whapi, затем проверяется реальное состояние номера.
 * Один токен Whapi — один номер, поэтому номер работает только в одном филиале.
 */
export async function connectChannel(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const token = getSecret(ctx.env, "WHAPI_TOKEN");
    if (!token) throw new AppError(409, "wa.whapiMissing");
    const busy = await ctx.db.select({ id: waChannels.id }).from(waChannels).where(and(eq(waChannels.companyId, actor.companyId), eq(waChannels.status, "connected"), ne(waChannels.branchId, branchId))).get();
    if (busy) throw new AppError(409, "wa.channelBusy");
    const phoneRaw = typeof body["phone"] === "string" ? body["phone"].trim() : "";
    const phone = phoneRaw ? `+${phoneRaw.replace(/\D/g, "")}` : null;
    if (phone && (phone.length < 8 || phone.length > 16)) throw new AppError(400, "validation.invalidInput", { fields: { phone: "validation.invalidInput" } });

    const secret = randomToken();
    const hash = await sha256Hex(secret);
    const existing = await ctx.db.select().from(waChannels).where(eq(waChannels.branchId, branchId)).get();
    const configured = await setWebhook(token, webhookUrl(ctx, secret));
    if (!configured.ok) throw new AppError(502, "wa.webhookFailed", { vars: { detail: configured.detail ?? "—" } });
    const values = { phone, webhookTokenHash: hash, status: "connected" as const, connectedBy: actor.userId, connectedAt: ctx.now };
    let channelId: string;
    if (existing) {
        channelId = existing.id;
        await ctx.db.update(waChannels).set(values).where(eq(waChannels.id, existing.id));
    } else {
        channelId = newId();
        await ctx.db.insert(waChannels).values({ id: channelId, companyId: actor.companyId, branchId, ...values });
    }
    await checkChannel(ctx, channelId);
    await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.channel.connect", entityType: "branch", entityId: branchId }, ctx.now);
    return studio(withBranch(ctx, branchId));
}

export async function checkChannelState(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const channel = await ctx.db.select().from(waChannels).where(eq(waChannels.branchId, branchId)).get();
    if (!channel) throw new AppError(409, "wa.channelMissing");
    await checkChannel(ctx, channel.id);
    return studio(withBranch(ctx, branchId));
}

export async function disconnectChannel(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    const channel = await ctx.db.select().from(waChannels).where(eq(waChannels.branchId, branchId)).get();
    if (channel) {
        // Старый адрес webhook перестаёт работать: хэш заменяется случайным.
        await ctx.db.update(waChannels).set({ status: "disconnected", webhookTokenHash: await sha256Hex(randomToken()) }).where(eq(waChannels.id, channel.id));
        await audit(ctx.db, { companyId: actor.companyId, actorUserId: actor.userId, action: "wa.channel.disconnect", entityType: "branch", entityId: branchId }, ctx.now);
    }
    return studio(withBranch(ctx, branchId));
}

export async function retryMessages(ctx: Ctx) {
    const actor = await requireActor(ctx);
    const body = await readJson(ctx.request);
    const branchId = await studioBranch(ctx, actor, bodyBranch(body));
    // Ручной повтор: исчерпанные попытки начинаются заново.
    await ctx.db
        .update(waMessages)
        .set({ attempts: 0 })
        .where(and(eq(waMessages.branchId, branchId), eq(waMessages.direction, "out"), eq(waMessages.status, "failed")));
    const result = await retryPending(ctx.env, ctx.now, { branchId, limit: 20 });
    return { ...result, ...(await studio(withBranch(ctx, branchId))) };
}

// --- Webhook -------------------------------------------------------------

/**
 * Точка входа Whapi. Секрет — в адресе (Whapi не подписывает запросы);
 * сравнивается по хэшу. Ответ — сразу, ответ клиенту готовится в продлении запроса.
 */
export async function webhook(ctx: Ctx) {
    const secret = ctx.params["token"] ?? "";
    await enforceRateLimit(ctx.env.DB, `wa-hook:${clientIp(ctx.request)}`, 600, 60_000, ctx.now, "wa.rateLimited");
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(secret)) throw new AppError(404, "error.notFound");
    const channel = await ctx.db.select().from(waChannels).where(eq(waChannels.webhookTokenHash, await sha256Hex(secret))).get();
    if (!channel || channel.status !== "connected") throw new AppError(404, "error.notFound");
    const body = await readJson(ctx.request);
    const replies = await acceptInbound(ctx.env, channel, parseWebhook(body), ctx.now);
    const work = (async () => {
        for (const id of replies) await deliver(ctx.env, id);
        // Заодно коротко повторяем старые неотправленные ответы.
        await retryPending(ctx.env, ctx.now, { branchId: channel.branchId, limit: 3, minAgeMs: 60_000 });
    })().catch((error: unknown) => console.error("[wa] delivery failed:", error instanceof Error ? error.message : String(error)));
    if (ctx.waitUntil) ctx.waitUntil(work);
    else await work;
    return { ok: true, accepted: replies.length };
}
