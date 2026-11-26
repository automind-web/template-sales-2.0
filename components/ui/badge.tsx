import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const pillTone: Record<Tone, string> = {
    neutral: "bg-[#eef0f4] text-[#4b5263]",
    info: "bg-selected text-primary",
    warning: "bg-[#fdf0dc] text-warning",
    success: "bg-[#e2f3e9] text-success",
    danger: "bg-[#fde7e6] text-danger",
};

/** Статус: точка + подпись. Состояние читается по тексту, а не только по цвету. */
export function StatusPill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
    return (
        <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", pillTone[tone], className)}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
            {children}
        </span>
    );
}

const dotTone: Record<Exclude<Tone, "info" | "neutral">, string> = { success: "text-success", warning: "text-warning", danger: "text-danger" };

/** Состояние подключения: «● Работает», «● Не подключён» */
export function StatusDot({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
    return (
        <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", dotTone[tone])}>
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />
            <span className="break-anywhere">{children}</span>
        </span>
    );
}

/** Пилюля-переключатель (фильтры, быстрые периоды) */
export function Chip({ selected, count, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; count?: number }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap transition-colors",
                selected ? "border-transparent bg-selected text-selected-foreground" : "border-border bg-surface text-foreground/80 hover:bg-muted",
                className
            )}
            {...props}
        >
            {children}
            {count !== undefined ? <span className="font-medium text-muted-foreground">{count}</span> : null}
        </button>
    );
}

/** Подсказка клавиш (Ctrl+Enter, /) */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
    return <kbd className={cn("rounded border border-current/25 px-1.5 py-px font-mono text-[11px] font-medium opacity-80", className)}>{children}</kbd>;
}

/** Небольшая метка без точки (например, «вы», «эта сессия») */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cn("inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground", className)}>{children}</span>;
}
