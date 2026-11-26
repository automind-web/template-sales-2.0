"use client";

import { useState } from "react";
import { ApiError, errorMessage } from "./api.ts";

/** Состояние отправки формы: занято, текст ошибки и ошибки полей с сервера */
export function useAction() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, string>>({});

    async function run(action: () => Promise<void>): Promise<boolean> {
        setBusy(true);
        setError(null);
        setFields({});
        try {
            await action();
            return true;
        } catch (caught) {
            setError(errorMessage(caught));
            if (caught instanceof ApiError) setFields(caught.fields);
            return false;
        } finally {
            setBusy(false);
        }
    }

    return { busy, error, fields, run, setError };
}
