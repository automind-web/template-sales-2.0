import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export const buttonVariants = cva(
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                /** Главное действие экрана */
                primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
                /** Обычное действие: белая кнопка с рамкой */
                secondary: "border border-border bg-surface text-foreground hover:bg-muted",
                /** Опасное действие: красная рамка (отозвать, в архив, выйти) */
                danger: "border border-danger/35 bg-surface text-danger hover:bg-danger/5",
                ghost: "text-foreground hover:bg-muted",
                link: "h-auto px-0 font-medium text-primary hover:underline",
            },
            size: {
                default: "control-h px-4",
                sm: "h-8 px-3 text-[13px]",
                icon: "control-h w-[var(--control-h)] p-0",
            },
        },
        defaultVariants: { variant: "primary", size: "default" },
    }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
