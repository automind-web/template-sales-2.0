import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
    return <h2 className={cn("text-base font-semibold break-anywhere", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "primary" }) {
    return (
        <span
            className={cn(
                "inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
                tone === "neutral" && "border-border bg-muted text-foreground",
                tone === "success" && "border-success/40 bg-success/10 text-success",
                tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
                tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
                tone === "primary" && "border-primary/40 bg-selected text-selected-foreground",
                className
            )}
            {...props}
        />
    );
}

export function Spinner({ label }: { label: string }) {
    return (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            {label}
        </div>
    );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="font-medium">{title}</p>
            {children}
        </div>
    );
}
