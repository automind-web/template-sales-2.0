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
        <div className={cn("grid gap-1", className)}>
            <Label htmlFor={id}>
                {label}
                {optional ? <span className="ml-1 font-normal text-muted-foreground">({t("common.optional")})</span> : null}
            </Label>
            {control}
            {hint ? (
                <p id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                </p>
            ) : null}
            {error ? (
                <p id={errorId} className="text-xs font-medium text-danger" role="alert">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

export function FormMessage({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
    return (
        <div
            role={kind === "error" ? "alert" : "status"}
            className={cn(
                "rounded-md border px-3 py-2 text-sm break-anywhere",
                kind === "error" && "border-danger/40 bg-danger/10 text-danger",
                kind === "success" && "border-success/40 bg-success/10 text-success",
                kind === "info" && "border-border bg-muted text-foreground"
            )}
        >
            {children}
        </div>
    );
}
