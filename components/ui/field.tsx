"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { cn } from "../../lib/utils.ts";
import { Label } from "./input.tsx";

/** Подпись + поле + подсказка + ошибка, связанные через aria */
export function Field({
    label,
    hint,
    error,
    optional,
    className,
    children,
}: {
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    optional?: boolean;
    className?: string;
    children: ReactElement<Record<string, unknown>>;
}) {
    const id = useId();
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
    const control = isValidElement(children)
        ? cloneElement(children, {
              id,
              "aria-invalid": error ? true : undefined,
              "aria-describedby": describedBy,
          })
        : children;
    return (
        <div className={cn("grid content-start gap-1.5", className)}>
            <Label htmlFor={id}>
                {label}
                {optional ? <span className="font-normal"> ({t("common.optional")})</span> : null}
            </Label>
            {control}
            {hint ? (
                <p id={hintId} className="text-xs font-semibold text-muted-foreground">
                    {hint}
                </p>
            ) : null}
            {error ? (
                <p id={errorId} className="text-xs font-semibold text-danger" role="alert">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

/** Двухколоночная сетка полей (на телефоне — одна колонка) */
export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
}

export function FormMessage({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
    return (
        <div
            role={kind === "error" ? "alert" : "status"}
            className={cn(
                "rounded-lg px-3.5 py-2.5 text-sm break-anywhere",
                kind === "error" && "bg-[#fde7e6] text-danger",
                kind === "success" && "bg-[#e2f3e9] text-success",
                kind === "info" && "bg-[#fff6dd] text-[#6b5310]"
            )}
        >
            {children}
        </div>
    );
}
