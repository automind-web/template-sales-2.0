"use client";

import { useEffect, useRef, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { blockedByDialog, hotkeyKeys, isTouchOnly, matchHotkey } from "../../lib/hotkeys.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";

const subscribeNothing = () => () => {};
const serverHint = () => null;
let cachedHint: string | null | undefined;
/** Подсказка зависит от ОС и типа экрана, поэтому вычисляется только в браузере */
function clientHint(): string | null {
    cachedHint ??= isTouchOnly() ? null : t("common.hotkeyHint", { action: t("hotkey.submitForm"), keys: hotkeyKeys("submitForm") });
    return cachedHint;
}

/**
 * Форма с сохранением по Ctrl+Enter / ⌘+Return, когда кнопка «Сохранить» доступна.
 * Не срабатывает при составном вводе (IME) и сквозь открытый поверх диалог.
 */
export function Form({
    onSubmit,
    canSubmit = true,
    busy = false,
    submitLabel = t("common.save"),
    secondary,
    className,
    children,
}: {
    onSubmit: () => void | Promise<void>;
    canSubmit?: boolean;
    busy?: boolean;
    submitLabel?: string;
    secondary?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const hint = useSyncExternalStore(subscribeNothing, clientHint, serverHint);
    const enabled = canSubmit && !busy;
    const enabledRef = useRef(enabled);
    const submitRef = useRef(onSubmit);
    useEffect(() => {
        enabledRef.current = enabled;
        submitRef.current = onSubmit;
    });

    useEffect(() => {
        const form = formRef.current;
        if (!form) return;
        function onKeyDown(event: KeyboardEvent) {
            if (!matchHotkey("submitForm", event)) return;
            if (blockedByDialog(event.target)) return;
            event.preventDefault();
            if (enabledRef.current) void submitRef.current();
        }
        form.addEventListener("keydown", onKeyDown);
        return () => form.removeEventListener("keydown", onKeyDown);
    }, []);

    function handleSubmit(event: FormEvent) {
        event.preventDefault();
        if (enabled) void onSubmit();
    }

    return (
        <form ref={formRef} onSubmit={handleSubmit} className={cn("grid gap-3", className)} noValidate>
            {children}
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" disabled={!enabled} title={hint ?? undefined} aria-keyshortcuts={hint ? (hotkeyKeys("submitForm").startsWith("⌘") ? "Meta+Enter" : "Control+Enter") : undefined}>
                    {busy ? t("common.loading") : submitLabel}
                </Button>
                {secondary}
                {hint ? <span className="hidden text-xs text-muted-foreground sm:inline">{hotkeyKeys("submitForm")}</span> : null}
            </div>
        </form>
    );
}
