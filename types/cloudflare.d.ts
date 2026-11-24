// Минимальные типы привязок Cloudflare, которые использует проект.
// Полный пакет @cloudflare/workers-types не подключаем: он конфликтует с DOM-типами фронтенда.
export {};

declare global {
    interface D1Result<T = Record<string, unknown>> {
        results: T[];
        success: boolean;
        meta: { changes?: number; last_row_id?: number; duration?: number; [key: string]: unknown };
    }

    interface D1PreparedStatement {
        bind(...values: unknown[]): D1PreparedStatement;
        first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
        run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
        raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
    }

    interface D1Database {
        prepare(query: string): D1PreparedStatement;
        batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
        exec(query: string): Promise<unknown>;
    }

    interface R2ObjectBody {
        key: string;
        size: number;
        httpMetadata?: { contentType?: string };
        arrayBuffer(): Promise<ArrayBuffer>;
        body: ReadableStream;
    }

    interface R2Bucket {
        get(key: string): Promise<R2ObjectBody | null>;
        put(
            key: string,
            value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
            options?: { httpMetadata?: { contentType?: string } }
        ): Promise<unknown>;
        delete(key: string | string[]): Promise<void>;
    }
}
