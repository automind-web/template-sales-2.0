import { ChevronDown } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

const fieldBase =
    "w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, "control-h", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5", className)} {...props} />;
});

/** Нативный список: на телефоне открывает системный выбор, удобный для касания */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
    return (
        <span className={cn("relative inline-flex w-full min-w-0", className)}>
            <select ref={ref} className={cn(fieldBase, "control-h appearance-none pr-9")} {...props} />
            <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </span>
    );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
    return <label className={cn("text-[13px] font-semibold text-foreground/75", className)} {...props} />;
}

/** Флажок с подписью, как в списках настроек */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string }>(function Checkbox({ label, className, ...props }, ref) {
    return (
        <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-foreground", props.disabled && "cursor-not-allowed opacity-60", className)}>
            <input ref={ref} type="checkbox" className="size-[18px] shrink-0 cursor-pointer rounded accent-[var(--brand-primary)]" {...props} />
            <span className="whitespace-nowrap">{label}</span>
        </label>
    );
});
