import { and, eq } from "drizzle-orm";
import { companySettings } from "../db/schema.ts";
import type { Db } from "./db.ts";

/** Настройка компании в JSON; null — не задана, действует значение из config/company.ts */
export async function readSetting<T>(db: Db, companyId: string, key: string): Promise<T | null> {
    const row = await db
        .select({ value: companySettings.value })
        .from(companySettings)
        .where(and(eq(companySettings.companyId, companyId), eq(companySettings.key, key)))
        .get();
    if (!row) return null;
    try {
        return JSON.parse(row.value) as T;
    } catch {
        return null;
    }
}

export async function writeSetting(db: Db, companyId: string, key: string, value: unknown, userId: string, now: number): Promise<void> {
    const json = JSON.stringify(value);
    await db
        .insert(companySettings)
        .values({ companyId, key, value: json, updatedAt: now, updatedBy: userId })
        .onConflictDoUpdate({ target: [companySettings.companyId, companySettings.key], set: { value: json, updatedAt: now, updatedBy: userId } });
}
