"use client";

import { t } from "../../i18n/index.ts";
import { Button } from "./button.tsx";
import { FormMessage } from "./field.tsx";

/** Состояние «ошибка с повтором» — одинаковое во всех разделах */
export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <FormMessage kind="error">{message}</FormMessage>
            <Button variant="secondary" onClick={onRetry}>
                {t("common.retry")}
            </Button>
        </div>
    );
}
