import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm text-[var(--acton-navy)] shadow-sm placeholder:text-[var(--acton-muted)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";
