import { eq } from "drizzle-orm";
import { companySettings } from "../db/schema.ts";
import type { Db } from "./db.ts";

/**
 * Настройки компании читаются одним запросом и запоминаются на время запроса
 * (объект Db создаётся заново для каждого запроса), поэтому воронка, видимость
 * заявок и прочие настройки не требуют отдельных обращений к базе.
 */
const cache = new WeakMap<Db, Map<string, Promise<Map<string, string>>>>();

function companyValues(db: Db, companyId: string): Promise<Map<string, string>> {
    let byCompany = cache.get(db);
    if (!byCompany) {
        byCompany = new Map();
        cache.set(db, byCompany);
    }
    let values = byCompany.get(companyId);
    if (!values) {
        values = db
            .select({ key: companySettings.key, value: companySettings.value })
            .from(companySettings)
            .where(eq(companySettings.companyId, companyId))
            .all()
            .then((rows) => new Map(rows.map((row) => [row.key, row.value])));
        byCompany.set(companyId, values);
        // Ошибку чтения не запоминаем: следующий вызов попробует снова.
        values.catch(() => byCompany!.delete(companyId));
    }
    return values;
}

/** Настройка компании в JSON; null — не задана, действует значение из config/company.ts */
export async function readSetting<T>(db: Db, companyId: string, key: string): Promise<T | null> {
    const raw = (await companyValues(db, companyId)).get(key);
    if (raw === undefined) return null;
    try {
        return JSON.parse(raw) as T;
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
    cache.get(db)?.delete(companyId);
}

/** Сбросить запомненные настройки после записи в обход writeSetting */
export function invalidateSettings(db: Db, companyId: string): void {
    cache.get(db)?.delete(companyId);
}
