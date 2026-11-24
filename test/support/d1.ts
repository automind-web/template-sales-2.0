import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type Value = null | number | bigint | string | Uint8Array;

function normalize(values: unknown[]): Value[] {
    return values.map((value) => {
        if (value === undefined) return null;
        if (typeof value === "boolean") return value ? 1 : 0;
        return value as Value;
    });
}

/**
 * Эмуляция Cloudflare D1 поверх node:sqlite для тестов без сборки.
 * Поведение, важное для приложения: batch выполняется как одна транзакция,
 * внешние ключи включены (как в D1).
 */
class Statement implements D1PreparedStatement {
    readonly #db: DatabaseSync;
    readonly #sql: string;
    readonly #params: Value[];

    constructor(db: DatabaseSync, sql: string, params: Value[] = []) {
        this.#db = db;
        this.#sql = sql;
        this.#params = params;
    }

    bind(...values: unknown[]): D1PreparedStatement {
        return new Statement(this.#db, this.#sql, normalize(values));
    }

    #prepare(): StatementSync {
        return this.#db.prepare(this.#sql);
    }

    runSync(): D1Result {
        const statement = this.#prepare();
        if (statement.columns().length > 0) {
            const results = statement.all(...this.#params) as Record<string, unknown>[];
            return { results, success: true, meta: { changes: results.length } };
        }
        const info = statement.run(...this.#params);
        return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    }

    async first<T>(column?: string): Promise<T | null> {
        const statement = this.#prepare();
        const rows = statement.all(...this.#params) as Record<string, unknown>[];
        const row = rows[0];
        if (!row) return null;
        return (column ? row[column] : row) as T;
    }

    async all<T>(): Promise<D1Result<T>> {
        return this.runSync() as D1Result<T>;
    }

    async run<T>(): Promise<D1Result<T>> {
        return this.runSync() as D1Result<T>;
    }

    async raw<T>(): Promise<T[]> {
        const statement = this.#prepare();
        if (statement.columns().length === 0) {
            statement.run(...this.#params);
            return [];
        }
        statement.setReturnArrays(true);
        return statement.all(...this.#params) as T[];
    }
}

export class TestD1 implements D1Database {
    readonly sqlite: DatabaseSync;

    constructor() {
        this.sqlite = new DatabaseSync(":memory:");
        this.sqlite.exec("PRAGMA foreign_keys = ON;");
    }

    prepare(query: string): D1PreparedStatement {
        return new Statement(this.sqlite, query);
    }

    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
        this.sqlite.exec("BEGIN");
        try {
            const results = statements.map((statement) => (statement as Statement).runSync() as D1Result<T>);
            this.sqlite.exec("COMMIT");
            return results;
        } catch (error) {
            this.sqlite.exec("ROLLBACK");
            throw error;
        }
    }

    async exec(query: string): Promise<unknown> {
        this.sqlite.exec(query);
        return { count: 1 };
    }
}

/** Применяет миграции из /drizzle по журналу, как это делает Sites при публикации */
export function applyMigrations(db: TestD1, directory = new URL("../../drizzle/", import.meta.url)): string[] {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8")) as {
        entries: Array<{ tag: string }>;
    };
    const files = readdirSync(directory).filter((file) => file.endsWith(".sql"));
    const applied: string[] = [];
    for (const entry of journal.entries) {
        const file = `${entry.tag}.sql`;
        if (!files.includes(file)) throw new Error(`Migration ${file} listed in journal is missing`);
        const sql = readFileSync(new URL(file, directory), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) {
            if (statement.trim()) db.sqlite.exec(statement);
        }
        applied.push(file);
    }
    return applied;
}
