"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./api.ts";

type State<T> = { key: string; data: T | null; error: string | null };

/**
 * Загрузка данных с сервера с состояниями «загрузка / ошибка / данные» и повтором.
 * Новые данные запрашиваются при смене ключа (например, филиала) и по reload().
 * Пока идёт загрузка, прежние данные остаются на экране (loading = true).
 */
export function useApiData<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
    const [version, setVersion] = useState(0);
    const fullKey = `${key}#${version}`;
    const [state, setState] = useState<State<T>>({ key: "", data: null, error: null });

    useEffect(() => {
        const controller = new AbortController();
        fetcher(controller.signal).then(
            (data) => {
                if (!controller.signal.aborted) setState({ key: fullKey, data, error: null });
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
    return { data: state.data, error: loading ? null : state.error, loading, reload };
}
