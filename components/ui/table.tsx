import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";
import { Card } from "./card.tsx";

/** Таблица в карточке. Широкая таблица прокручивается внутри карточки, а не всей страницей. */
export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
    return (
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
                <table className={cn("w-full border-collapse text-sm", className)} {...props}>
                    {children}
                </table>
            </div>
        </Card>
    );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
    return <thead className={cn("bg-muted/70", className)} {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
    return <th className={cn("px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
    return <tr className={cn("border-t border-border", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
    return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

/** Строка списка в карточке (приглашения, сессии, назначения) */
export function ListCard({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <Card className={cn("overflow-hidden", className)}>
            <ul className="divide-y divide-border">{children}</ul>
        </Card>
    );
}

export function ListRow({ children, className }: { children: React.ReactNode; className?: string }) {
    return <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5", className)}>{children}</li>;
}
