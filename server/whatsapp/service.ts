/**
 * WhatsApp: входящие сообщения, лиды из WhatsApp и очередь ответов.
 *
 * Долгих фоновых процессов нет: ответ готовится в продлении запроса (waitUntil),
 * а неотправленные ответы лежат в таблице wa_messages и повторяются коротко —
 * при следующем входящем, по кнопке «Повторить» или по расписанию Sites (если включено).
 */
import { and, asc, eq, inArray, lt, gt, or } from "drizzle-orm";
import { companyConfig } from "../../config/company.ts";
import { leads, waAgents, waChannels, waMaterials, waMessages } from "../../db/schema.ts";
import { assistantModel, getFunnel } from "../crm/funnel.ts";
import { buildSearchText } from "../crm/leads.ts";
import { createDb, isUniqueViolation, newId, type Db } from "../db.ts";
import { getSecret, type Env } from "../runtime.ts";
import { answer, type AgentReply } from "./agent.ts";
import { phoneFromChat, sendText } from "./whapi.ts";

export const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_MS = 24 * 3_600_000;
const TEXT_LIMIT = 4_000;

export type InboundMessage = { id: string; chatId: string; text: string; fromMe: boolean; type: string; name: string | null };

/** Разбор тела webhook Whapi: берём только текстовые личные сообщения от клиентов */
export function parseWebhook(body: unknown): InboundMessage[] {
    if (typeof body !== "object" || body === null) return [];
    const list = (body as { messages?: unknown }).messages;
    if (!Array.isArray(list)) return [];
    const result: InboundMessage[] = [];
    for (const raw of list.slice(0, 50)) {
        if (typeof raw !== "object" || raw === null) continue;
        const item = raw as Record<string, unknown>;
        const id = typeof item["id"] === "string" ? item["id"].slice(0, 128) : "";
        const chatId = typeof item["chat_id"] === "string" ? item["chat_id"].slice(0, 64) : "";
        const textBody = (item["text"] as { body?: unknown } | undefined)?.body;
        const text = typeof textBody === "string" ? textBody.slice(0, TEXT_LIMIT) : "";
        const name = typeof item["from_name"] === "string" ? item["from_name"].trim().slice(0, 120) || null : null;
        if (!id || !chatId) continue;
        result.push({ id, chatId, text, fromMe: item["from_me"] === true, type: String(item["type"] ?? ""), name });
    }
    return result;
}

type Channel = typeof waChannels.$inferSelect;

/** Лид по номеру в филиале; для незнакомого номера — новый лид без ответственного */
async function leadForPhone(env: Env, db: Db, channel: Channel, phone: string, name: string | null, now: number): Promise<string> {
    const existing = await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.companyId, channel.companyId), eq(leads.branchId, channel.branchId), eq(leads.clientPhone, phone)))
        .orderBy(asc(leads.closedAt), asc(leads.createdAt))
        .get();
    if (existing) return existing.id;
    const funnel = await getFunnel(db, channel.companyId);
    const stage = funnel.stages[0]!.key;
    const clientName = name ?? phone;
    const id = newId();
    const opId = `wa-${phone.replace(/\D/g, "")}-${channel.branchId}`.slice(0, 64);
    const d1 = env.DB;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await d1.batch([
                d1
                    .prepare(
                        `INSERT INTO leads (id, company_id, branch_id, number, client_name, client_phone, client_company, source, stage, owner_user_id, next_contact_at, amount, lost_reason, search_text, version, last_op_id, created_by, created_at, updated_at, stage_changed_at)
                         SELECT ?, ?, ?, COALESCE(MAX(number), 0) + 1, ?, ?, NULL, 'whatsapp', ?, NULL, NULL, NULL, NULL, '', 1, ?, NULL, ?, ?, ? FROM leads WHERE company_id = ?`
                    )
                    .bind(id, channel.companyId, channel.branchId, clientName, phone, stage, opId, now, now, now, channel.companyId),
                d1
                    .prepare("INSERT INTO lead_events (id, lead_id, company_id, branch_id, type, field, old_value, new_value, actor_user_id, op_id, created_at) VALUES (?, ?, ?, ?, 'created', 'source', NULL, ?, NULL, ?, ?)")
                    .bind(newId(), id, channel.companyId, channel.branchId, stage, opId, now),
                d1.prepare("INSERT INTO lead_operations (op_id, lead_id, user_id, created_at) VALUES (?, ?, NULL, ?)").bind(opId, id, now),
            ]);
            break;
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // Параллельная доставка уже создала лид для этого номера.
            const again = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.branchId, channel.branchId), eq(leads.clientPhone, phone))).get();
            if (again) return again.id;
            if (attempt === 2) throw error;
        }
    }
    const created = await db.select({ number: leads.number }).from(leads).where(eq(leads.id, id)).get();
    if (created) await db.update(leads).set({ searchText: buildSearchText(created.number, clientName, phone, null) }).where(eq(leads.id, id));
    return id;
}

/**
 * Принимает входящие сообщения канала. Повтор того же сообщения (тот же id)
 * ничего не создаёт. Возвращает id исходящих ответов, которые нужно отправить.
 */
export async function acceptInbound(env: Env, channel: Channel, messages: InboundMessage[], now: number): Promise<string[]> {
    const db = createDb(env.DB);
    const agent = await db.select({ id: waAgents.id }).from(waAgents).where(eq(waAgents.branchId, channel.branchId)).get();
    const replies: string[] = [];
    for (const message of messages) {
        if (message.fromMe) continue;
        const phone = phoneFromChat(message.chatId);
        if (!phone) continue; // группы, рассылки, статусы — не обрабатываем
        const text = message.type === "text" ? message.text.trim() : "";
        const inboundId = newId();
        const inserted = await env.DB
            .prepare(
                "INSERT INTO wa_messages (id, company_id, branch_id, chat_id, direction, text, external_id, status, error, attempts, lead_id, reply_to_id, created_at) VALUES (?, ?, ?, ?, 'in', ?, ?, 'received', NULL, 0, NULL, NULL, ?) ON CONFLICT(external_id) DO NOTHING"
            )
            .bind(inboundId, channel.companyId, channel.branchId, message.chatId, text || `[${message.type || "media"}]`, message.id, now)
            .run();
        if (!inserted.meta.changes) continue; // повторная доставка
        const leadId = await leadForPhone(env, db, channel, phone, message.name, now);
        await db.update(waMessages).set({ leadId }).where(eq(waMessages.id, inboundId));
        if (!agent || !text) continue;
        const replyId = newId();
        await db.insert(waMessages).values({
            id: replyId,
            companyId: channel.companyId,
            branchId: channel.branchId,
            chatId: message.chatId,
            direction: "out",
            text: "",
            status: "pending",
            attempts: 0,
            leadId,
            replyToId: inboundId,
            createdAt: now,
        });
        replies.push(replyId);
    }
    await db.update(waChannels).set({ lastInboundAt: now }).where(eq(waChannels.id, channel.id));
    return replies;
}

/** Материалы и настройки агента филиала */
export async function agentContext(db: Db, branchId: string) {
    const agent = await db.select().from(waAgents).where(eq(waAgents.branchId, branchId)).get();
    if (!agent) return null;
    const materials = await db.select({ title: waMaterials.title, body: waMaterials.body }).from(waMaterials).where(eq(waMaterials.agentId, agent.id)).orderBy(asc(waMaterials.createdAt)).all();
    return { agent, materials, model: await assistantModel(db, agent.companyId) };
}

export async function agentAnswer(env: Env, db: Db, branchId: string, question: string, history: Array<{ role: "user" | "assistant"; text: string }> = []): Promise<AgentReply | null> {
    const context = await agentContext(db, branchId);
    if (!context) return null;
    return answer({
        apiKey: getSecret(env, "OPENAI_API_KEY"),
        model: context.model,
        name: context.agent.name,
        instructions: context.agent.instructions,
        materials: context.materials,
        question,
        history,
    });
}

/** Готовит (если ещё нет) и отправляет один ответ. Ошибка записывается, а не выбрасывается. */
export async function deliver(env: Env, messageId: string): Promise<"sent" | "failed" | "skipped"> {
    const db = createDb(env.DB);
    const message = await db.select().from(waMessages).where(eq(waMessages.id, messageId)).get();
    if (!message || message.direction !== "out" || message.status === "sent" || message.attempts >= MAX_ATTEMPTS) return "skipped";
    // Захват: только один обработчик увеличивает счётчик попытки.
    const claimed = await env.DB
        .prepare("UPDATE wa_messages SET attempts = attempts + 1, status = 'pending' WHERE id = ? AND attempts = ? AND status <> 'sent'")
        .bind(message.id, message.attempts)
        .run();
    if (!claimed.meta.changes) return "skipped";
    let text = message.text;
    try {
        if (!text) {
            const question = message.replyToId ? await db.select({ text: waMessages.text }).from(waMessages).where(eq(waMessages.id, message.replyToId)).get() : null;
            const reply = await agentAnswer(env, db, message.branchId, question?.text ?? "");
            if (!reply) throw new Error("agent not configured");
            text = reply.text;
            await db.update(waMessages).set({ text }).where(eq(waMessages.id, message.id));
        }
        const token = getSecret(env, "WHAPI_TOKEN");
        if (!token) throw new Error("WHAPI_TOKEN is not set");
        const sent = await sendText(token, message.chatId, text);
        if (!sent.ok) throw new Error(sent.detail ?? "send failed");
        await db.update(waMessages).set({ status: "sent", error: null }).where(eq(waMessages.id, message.id));
        return "sent";
    } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await db.update(waMessages).set({ status: "failed", error: detail }).where(eq(waMessages.id, message.id));
        return "failed";
    }
}

/** Повтор неотправленных ответов (коротко: ограниченное число за вызов) */
export async function retryPending(env: Env, now: number, options: { branchId?: string; limit?: number; minAgeMs?: number } = {}) {
    const db = createDb(env.DB);
    const conditions = [
        eq(waMessages.direction, "out"),
        inArray(waMessages.status, ["pending", "failed"]),
        lt(waMessages.attempts, MAX_ATTEMPTS),
        gt(waMessages.createdAt, now - RETRY_WINDOW_MS),
        lt(waMessages.createdAt, now - (options.minAgeMs ?? 0)),
    ];
    if (options.branchId) conditions.push(eq(waMessages.branchId, options.branchId));
    const rows = await db
        .select({ id: waMessages.id })
        .from(waMessages)
        .where(and(...conditions, or(eq(waMessages.status, "failed"), lt(waMessages.createdAt, now - 60_000))))
        .orderBy(asc(waMessages.createdAt))
        .limit(options.limit ?? 10)
        .all();
    const result = { sent: 0, failed: 0 };
    for (const row of rows) {
        const outcome = await deliver(env, row.id);
        if (outcome === "sent") result.sent += 1;
        if (outcome === "failed") result.failed += 1;
    }
    return result;
}

export const baseAgent = { name: companyConfig.whatsappAgent.name, instructions: companyConfig.whatsappAgent.instructions };
