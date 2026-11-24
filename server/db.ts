import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.ts";

export function createDb(d1: D1Database) {
    return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;

export function newId(): string {
    return crypto.randomUUID();
}

/** D1 бросает ошибку с текстом SQLite при нарушении уникальности */
export function isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
    return /UNIQUE constraint failed/i.test(message);
}
