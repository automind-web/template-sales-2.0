"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; tone?: "danger" };

/**
 * Меню «…»: открывается касанием, кликом или с клавиатуры (Enter/Space),
 * стрелки переходят по пунктам, Esc закрывает и возвращает фокус на кнопку.
 */
export function Menu({ label, items, header, className }: { label: string; items: MenuItem[]; header?: ReactNode; className?: string }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listId = useId();

    useEffect(() => {
        if (!open) return;
        const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
        first?.focus();
        function onPointer(event: PointerEvent) {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        }
        document.addEventListener("pointerdown", onPointer);
        return () => document.removeEventListener("pointerdown", onPointer);
    }, [open]);

    function onKeyDown(event: React.KeyboardEvent) {
        if (!open) return;
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            items[(index + 1) % items.length]?.focus();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            items[(index - 1 + items.length) % items.length]?.focus();
        } else if (event.key === "Tab") {
            setOpen(false);
        }
    }

    return (
        <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
            <button
                ref={buttonRef}
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-foreground/70 hover:bg-muted"
            >
                <Ellipsis className="size-5" />
            </button>
            {open ? (
                <div id={listId} role="menu" aria-label={label} className="absolute top-9 right-0 z-30 min-w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl" onClick={(event) => event.stopPropagation()}>
                    {header ? <div className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{header}</div> : null}
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false);
                                buttonRef.current?.focus();
                                item.onSelect();
                            }}
                            className={cn("block w-full cursor-pointer px-3 py-2 text-left text-sm font-medium hover:bg-muted focus:bg-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50", item.tone === "danger" && "text-danger")}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
