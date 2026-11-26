import type { Db } from "./db.ts";
import type { Env, WaitUntil } from "./runtime.ts";
import type { Actor } from "./auth.ts";

/** Контекст одного API-запроса */
export type Ctx = {
    request: Request;
    env: Env;
    db: Db;
    url: URL;
    params: Record<string, string>;
    now: number;
    cookies: Map<string, string>;
    /** Set-Cookie, которые нужно добавить к ответу */
    setCookies: string[];
    /** Фоновая работа после ответа; null — выполнять сразу (тесты, локальные вызовы) */
    waitUntil: WaitUntil | null;
    /** Кэш пользователя на время запроса (права перечитываются на каждом запросе) */
    actor?: Actor | null;
};
