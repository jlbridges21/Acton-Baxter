import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] disabled:pointer-events-none disabled:opacity-50 print:hidden",
  {
    variants: {
      variant: {
        primary: "bg-[var(--acton-navy)] text-white hover:bg-[var(--acton-navy-dark)]",
        accent:
          "bg-[var(--acton-yellow)] text-[var(--acton-navy)] hover:bg-[var(--acton-yellow-dark)]",
        secondary:
          "border border-[var(--acton-border)] bg-white text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
        ghost: "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
        danger: "bg-red-700 text-white hover:bg-red-800",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";
