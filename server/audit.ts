import { auditLog } from "../db/schema.ts";
import { newId, type Db } from "./db.ts";

export type AuditEntry = {
    companyId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    data?: Record<string, unknown>;
};

export function auditInsert(db: Db, entry: AuditEntry, now: number) {
    return db.insert(auditLog).values({
        id: newId(),
        companyId: entry.companyId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        data: entry.data ? JSON.stringify(entry.data) : null,
        createdAt: now,
    });
}

export async function audit(db: Db, entry: AuditEntry, now: number): Promise<void> {
    await auditInsert(db, entry, now);
}
