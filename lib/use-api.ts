"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./api.ts";

type State<T> = { key: string; data: T | null; error: string | null };

/**
 * Последние ответы по ключу (в памяти вкладки). При повторном открытии страницы
 * данные показываются сразу и тихо обновляются с сервера — переход не ждёт сети.
 * После выхода страница перезагружается целиком, и кэш исчезает вместе с ней.
 */
const cache = new Map<string, unknown>();
const CACHE_LIMIT = 60;

function remember(key: string, data: unknown) {
    cache.delete(key);
    cache.set(key, data);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/** Сбросить запомненные ответы (например, после выхода) */
export function clearApiCache() {
    cache.clear();
}

/**
 * Загрузка данных с сервера с состояниями «загрузка / ошибка / данные» и повтором.
 * Новые данные запрашиваются при смене ключа (например, филиала) и по reload().
 * Пока идёт загрузка, на экране — запомненные данные этого ключа или прежние данные (loading = true).
 */
export function useApiData<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
    const [version, setVersion] = useState(0);
    const fullKey = `${key}#${version}`;
    const [state, setState] = useState<State<T>>(() => ({ key: "", data: (cache.get(key) as T | undefined) ?? null, error: null }));

    useEffect(() => {
        const controller = new AbortController();
        fetcher(controller.signal).then(
            (data) => {
                if (controller.signal.aborted) return;
                remember(key, data);
                setState({ key: fullKey, data, error: null });
            },
            (error: unknown) => {
                if (!controller.signal.aborted) setState((current) => ({ key: fullKey, data: current.data, error: errorMessage(error) }));
            }
        );
        return () => controller.abort();
        // fetcher намеренно не в зависимостях: запрос определяется ключом.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fullKey]);

    const reload = useCallback(() => setVersion((value) => value + 1), []);
    const loading = state.key !== fullKey;
    // Пока свежий ответ не пришёл — показываем запомненный для этого ключа, если он есть.
    const cached = loading && cache.has(key) ? (cache.get(key) as T) : null;
    const data = state.key === fullKey ? state.data : (cached ?? state.data);
    return { data, error: loading ? null : state.error, loading, reload };
}
