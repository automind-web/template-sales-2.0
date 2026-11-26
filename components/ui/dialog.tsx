"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n/index.ts";
import { matchHotkey, pushDialog, topDialog } from "../../lib/hotkeys.ts";
import { cn } from "../../lib/utils.ts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальный диалог: фокус остаётся внутри (Tab/Shift+Tab), Esc закрывает
 * только верхний диалог, после закрытия фокус возвращается на вызвавший элемент.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    className,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const panel = panelRef.current;
        if (!panel) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const release = pushDialog(panel);
        const first = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(`.dialog-body :is(${FOCUSABLE})`) ?? panel;
        first.focus();
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        function onKeyDown(event: KeyboardEvent) {
            if (topDialog() !== panel || !panel) return;
            if (matchHotkey("closeDialog", event)) {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key === "Tab") {
                const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null);
                if (items.length === 0) {
                    event.preventDefault();
                    return;
                }
                const firstItem = items[0]!;
                const lastItem = items[items.length - 1]!;
                const active = document.activeElement;
                if (event.shiftKey && (active === firstItem || !panel.contains(active))) {
                    event.preventDefault();
                    lastItem.focus();
                } else if (!event.shiftKey && (active === lastItem || !panel.contains(active))) {
                    event.preventDefault();
                    firstItem.focus();
                }
            }
        }
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            release();
            document.body.style.overflow = previousOverflow;
            if (opener && document.contains(opener)) opener.focus();
        };
    }, [open]);

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d2433]/45 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl", className)}
            >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-xl font-bold break-anywhere">
                            {title}
                        </h2>
                        {description ? (
                            <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground break-anywhere">
                                {description}
                            </p>
                        ) : null}
                    </div>
                    <button type="button" onClick={onClose} className="-mr-1.5 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-foreground/70 hover:bg-muted" aria-label={t("common.close")}>
                        <X className="size-5" />
                    </button>
                </div>
                <div className="dialog-body p-5">{children}</div>
            </div>
        </div>,
        document.body
    );
}
