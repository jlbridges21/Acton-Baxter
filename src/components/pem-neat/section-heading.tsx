import { cn } from "@/lib/utils";

export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "border-b border-[var(--acton-border)] pb-2 text-sm font-bold tracking-wide text-[var(--acton-navy)] uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}

export function SubSectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h4 className={cn("text-sm font-semibold text-[var(--acton-navy)]", className)}>{children}</h4>
  );
}

export function ProseBlock({
  children,
  emptyLabel = "Not established",
  className,
}: {
  children: React.ReactNode;
  emptyLabel?: string;
  className?: string;
}) {
  const isEmpty =
    children == null ||
    (typeof children === "string" && !children.trim()) ||
    children === false;
  return (
    <p className={cn("text-sm leading-relaxed text-[var(--acton-navy)]", className)}>
      {isEmpty ? (
        <span className="text-[var(--acton-muted)]">{emptyLabel}</span>
      ) : (
        children
      )}
    </p>
  );
}
