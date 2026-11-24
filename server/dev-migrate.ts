/// <reference types="vite/client" />
/**
 * Только для `npm run dev`: применяет SQL-миграции к локальной D1 (Miniflare).
 * В рабочей сборке этот модуль не используется — Sites применяет упакованные
 * миграции из dist/.openai/drizzle до переключения трафика.
 */

const migrations = import.meta.glob("../drizzle/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

let done: Promise<void> | null = null;

export function applyDevMigrations(db: D1Database): Promise<void> {
    done ??= run(db).catch((error: unknown) => {
        done = null;
        throw error;
    });
    return done;
}

async function run(db: D1Database): Promise<void> {
    await db.prepare("CREATE TABLE IF NOT EXISTS _dev_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)").run();
    const applied = await db.prepare("SELECT name FROM _dev_migrations").all<{ name: string }>();
    const appliedNames = new Set(applied.results.map((row) => row.name));
    for (const path of Object.keys(migrations).sort()) {
        const name = path.split("/").pop() ?? path;
        if (appliedNames.has(name)) continue;
        const statements = (migrations[path] ?? "")
            .split("--> statement-breakpoint")
            .map((statement) => statement.trim())
            .filter(Boolean)
            .map((statement) => db.prepare(statement));
        statements.push(db.prepare("INSERT INTO _dev_migrations (name, applied_at) VALUES (?1, ?2)").bind(name, Date.now()));
        await db.batch(statements);
        console.log(`[dev] applied migration ${name}`);
    }
}
