import { cn } from "@/lib/utils";

const toneClasses = {
  navy: "bg-[var(--acton-navy)] text-white",
  yellow: "bg-[var(--acton-yellow)] text-[var(--acton-navy)]",
  gray: "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]",
  green: "bg-emerald-100 text-emerald-900",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-900",
  blue: "bg-sky-100 text-sky-900",
} as const;

export function Badge({
  children,
  tone = "gray",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
