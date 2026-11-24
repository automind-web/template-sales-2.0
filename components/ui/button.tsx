import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export const buttonVariants = cva(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
    {
        variants: {
            variant: {
                primary: "bg-primary text-primary-foreground hover:bg-primary/90",
                secondary: "border border-border bg-surface text-foreground hover:bg-muted",
                ghost: "text-foreground hover:bg-muted",
                danger: "bg-danger text-danger-foreground hover:bg-danger/90",
                "danger-ghost": "text-danger hover:bg-danger/10",
                link: "text-primary underline-offset-4 hover:underline px-0",
            },
            size: {
                default: "control-h px-3",
                sm: "h-7 px-2 text-xs",
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
