import { companyConfig, type FunnelConfig, type FunnelStage } from "../../config/company.ts";
import type { Db } from "../db.ts";
import { AppError } from "../http.ts";
import { readSetting } from "../settings-store.ts";

export const REQUIRED_FIELDS = ["amount", "comment", "nextContactAt", "lostReason"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const FUNNEL_KEY = "crm.funnel";
export const SEE_BRANCH_KEY = "crm.employeesSeeBranch";
export const MODEL_KEY = "wa.model";

/** Воронка компании: сохранённая директором или из config/company.ts */
export async function getFunnel(db: Db, companyId: string): Promise<FunnelConfig> {
    const stored = await readSetting<FunnelConfig>(db, companyId, FUNNEL_KEY);
    if (stored) {
        try {
            return validateFunnel(stored);
        } catch {
            // Повреждённая настройка не ломает CRM: работаем по шаблону.
        }
    }
    return companyConfig.funnel;
}

export async function employeesSeeBranch(db: Db, companyId: string): Promise<boolean> {
    return (await readSetting<boolean>(db, companyId, SEE_BRANCH_KEY)) ?? companyConfig.employeesSeeBranchLeads;
}

export async function assistantModel(db: Db, companyId: string): Promise<string> {
    const stored = await readSetting<string>(db, companyId, MODEL_KEY);
    return stored && companyConfig.whatsappAgent.models.includes(stored) ? stored : companyConfig.whatsappAgent.model;
}

const KEY = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Проверка воронки. Ключи этапов неизменны после появления лидов — их
 * нельзя удалить, если они встречаются в данных (проверяет вызывающий код).
 */
export function validateFunnel(input: unknown): FunnelConfig {
    const bad = (message: string) => new AppError(400, "crm.funnelInvalid", { extra: { detail: message } });
    if (typeof input !== "object" || input === null) throw bad("funnel");
    const raw = input as { stages?: unknown; transitions?: unknown };
    if (!Array.isArray(raw.stages) || raw.stages.length < 2 || raw.stages.length > 20) throw bad("stages");
    const keys = new Set<string>();
    const stages: FunnelStage[] = raw.stages.map((item) => {
        if (typeof item !== "object" || item === null) throw bad("stage");
        const stage = item as Record<string, unknown>;
        const key = String(stage["key"] ?? "");
        const label = String(stage["label"] ?? "").trim();
        if (!KEY.test(key) || keys.has(key)) throw bad(`key ${key}`);
        if (label.length < 1 || label.length > 40) throw bad(`label ${key}`);
        keys.add(key);
        const terminal = stage["terminal"];
        if (terminal !== undefined && terminal !== null && terminal !== "won" && terminal !== "lost") throw bad(`terminal ${key}`);
        const required = Array.isArray(stage["requiredFields"]) ? stage["requiredFields"] : [];
        const requiredFields = [...new Set(required.map(String))].filter((field): field is RequiredField => (REQUIRED_FIELDS as readonly string[]).includes(field));
        return { key, label, ...(terminal ? { terminal: terminal as "won" | "lost" } : {}), requiredFields };
    });
    if (stages[0]?.terminal) throw bad("first stage must be open");
    if (!stages.some((stage) => stage.terminal === "won")) throw bad("won stage required");
    const transitionsRaw = (raw.transitions ?? {}) as Record<string, unknown>;
    const transitions: Record<string, string[]> = {};
    for (const stage of stages) {
        const list = Array.isArray(transitionsRaw[stage.key]) ? (transitionsRaw[stage.key] as unknown[]).map(String) : [];
        transitions[stage.key] = [...new Set(list)].filter((target) => keys.has(target) && target !== stage.key);
    }
    return { stages, transitions };
}

export function stageOf(funnel: FunnelConfig, key: string): FunnelStage | undefined {
    return funnel.stages.find((stage) => stage.key === key);
}

export function isTerminal(funnel: FunnelConfig, key: string): boolean {
    return Boolean(stageOf(funnel, key)?.terminal);
}

export function canTransition(funnel: FunnelConfig, from: string, to: string): boolean {
    return from === to || (funnel.transitions[from] ?? []).includes(to);
}
