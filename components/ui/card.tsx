import type { LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("rounded-2xl border border-border bg-surface shadow-[0_1px_2px_#1d24330a,0_10px_30px_-20px_#1d243333]", className)} {...props} />;
}

/** Карточка-раздел: заголовок, необязательное действие справа, содержимое */
export function Section({ title, action, className, children }: { title?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
    return (
        <Card className={cn("p-5", className)}>
            {title || action ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    {title ? <h2 className="text-[17px] font-bold break-anywhere">{title}</h2> : <span />}
                    {action}
                </div>
            ) : null}
            {children}
        </Card>
    );
}

/** Подпись капсом и значение (как в карточке профиля и задачи) */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
            <div className="mt-1 text-[15px] break-anywhere">{children}</div>
        </div>
    );
}

export function Spinner({ label }: { label: string }) {
    return (
        <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
            {label}
        </div>
    );
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            {Icon ? (
                <span aria-hidden className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    <Icon className="size-5" />
                </span>
            ) : null}
            <p className="font-bold">{title}</p>
            {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
        </div>
    );
}
