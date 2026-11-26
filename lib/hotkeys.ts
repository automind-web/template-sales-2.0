"use client";

/**
 * Единый список горячих клавиш. Из него берутся и подсказки рядом с
 * действиями, и обработчики. Учитываются ОС (⌘ на macOS), экран (на
 * сенсорных экранах подсказки не показываются — действия доступны касанием)
 * и роль (через поле roles).
 */
import { useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n/index.ts";

export type HotkeyId = "focusSearch" | "openSelected" | "submitForm" | "closeDialog";

type Hotkey = {
    id: HotkeyId;
    labelKey: MessageKey;
    /** Подпись для Windows/Linux и macOS */
    keys: { other: string; mac: string };
    /** Где действует (для справки и документации) */
    scope: string;
    roles?: Array<"director" | "manager" | "employee">;
    match: (event: KeyboardEvent, mac: boolean) => boolean;
};

export const HOTKEYS: Record<HotkeyId, Hotkey> = {
    focusSearch: {
        id: "focusSearch",
        labelKey: "hotkey.focusSearch",
        keys: { other: "/", mac: "/" },
        scope: "Список CRM, вне поля ввода",
        match: (event) => event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey,
    },
    openSelected: {
        id: "openSelected",
        labelKey: "hotkey.openSelected",
        keys: { other: "Enter", mac: "Return" },
        scope: "Список CRM",
        match: (event) => event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
    },
    submitForm: {
        id: "submitForm",
        labelKey: "hotkey.submitForm",
        keys: { other: "Ctrl+Enter", mac: "⌘+Return" },
        scope: "Форма, когда «Сохранить» доступно",
        match: (event, mac) => event.key === "Enter" && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey),
    },
    closeDialog: {
        id: "closeDialog",
        labelKey: "hotkey.closeDialog",
        keys: { other: "Esc", mac: "Esc" },
        scope: "Верхний диалог; фокус возвращается на вызвавший элемент",
        match: (event) => event.key === "Escape",
    },
};

export function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") return false;
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
    return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Сенсорный экран без клавиатуры: подсказки клавиш не показываем */
export function isTouchOnly(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function hotkeyKeys(id: HotkeyId): string {
    const hotkey = HOTKEYS[id];
    return isMacPlatform() ? hotkey.keys.mac : hotkey.keys.other;
}

/** Составной ввод (IME): сочетания не срабатывают */
export function isComposing(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

export function matchHotkey(id: HotkeyId, event: KeyboardEvent): boolean {
    if (isComposing(event)) return false;
    return HOTKEYS[id].match(event, isMacPlatform());
}

export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
        const type = (target as HTMLInputElement).type;
        return !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color"].includes(type);
    }
    return false;
}

// --- Стек открытых диалогов: сочетания не срабатывают сквозь диалог ---

const dialogStack: HTMLElement[] = [];

export function pushDialog(element: HTMLElement): () => void {
    dialogStack.push(element);
    return () => {
        const index = dialogStack.lastIndexOf(element);
        if (index >= 0) dialogStack.splice(index, 1);
    };
}

export function topDialog(): HTMLElement | null {
    return dialogStack[dialogStack.length - 1] ?? null;
}

/** Событие пришло не из верхнего диалога, хотя диалог открыт — его надо игнорировать */
export function blockedByDialog(target: EventTarget | null): boolean {
    const top = topDialog();
    if (!top) return false;
    return !(target instanceof Node && top.contains(target));
}

const subscribeNothing = () => () => {};

/** Показывать ли подсказки клавиш: только в браузере и не на сенсорном экране без клавиатуры */
export function useHotkeyHints(): boolean {
    return useSyncExternalStore(subscribeNothing, () => !isTouchOnly(), () => false);
}
