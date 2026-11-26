"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { blockedByDialog, hotkeyKeys, matchHotkey, useHotkeyHints } from "../../lib/hotkeys.ts";
import { cn } from "../../lib/utils.ts";
import { Kbd } from "./badge.tsx";
import { Button } from "./button.tsx";

/**
 * Форма с сохранением по Ctrl+Enter / ⌘+Return, когда кнопка доступна.
 * Не срабатывает при составном вводе (IME) и сквозь открытый поверх диалог.
 *
 * variant: page — кнопки слева; dialog — подвал диалога, кнопки справа;
 * auth — одна широкая кнопка без подсказки клавиш (страницы входа).
 */
export function Form({
    onSubmit,
    canSubmit = true,
    busy = false,
    submitLabel = t("common.save"),
    secondary,
    variant = "page",
    className,
    children,
}: {
    onSubmit: () => unknown;
    canSubmit?: boolean;
    busy?: boolean;
    submitLabel?: string;
    secondary?: ReactNode;
    variant?: "page" | "dialog" | "auth";
    className?: string;
    children: ReactNode;
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const keys = useHotkeyHints() ? hotkeyKeys("submitForm") : null;
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

    const showKeys = variant !== "auth" && keys !== null;
    const submit = (
        <Button
            type="submit"
            disabled={!enabled}
            className={variant === "auth" ? "w-full" : undefined}
            title={showKeys ? t("common.hotkeyHint", { action: t("hotkey.submitForm"), keys: keys ?? "" }) : undefined}
            aria-keyshortcuts={showKeys ? (keys?.startsWith("⌘") ? "Meta+Enter" : "Control+Enter") : undefined}
        >
            {busy ? t("common.loading") : submitLabel}
            {showKeys ? <Kbd className="hidden sm:inline">{keys}</Kbd> : null}
        </Button>
    );

    return (
        <form ref={formRef} onSubmit={handleSubmit} className={cn("grid gap-4", className)} noValidate>
            {children}
            {variant === "dialog" ? (
                <div className="-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">
                    {secondary}
                    {submit}
                </div>
            ) : (
                <div className={cn("flex flex-wrap items-center gap-2", variant === "auth" ? "pt-1" : "")}>
                    {submit}
                    {secondary}
                </div>
            )}
        </form>
    );
}
