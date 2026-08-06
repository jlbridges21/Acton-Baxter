import * as React from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReportSectionId } from "@/lib/research/report-view-model";

/**
 * Shared shell for every report section so headers, anchors, and spacing stay
 * identical across sections that were built in different prompts.
 *
 * `description` is the one-line "what this tells you"; `sourceNote` is the
 * dominant-source attribution for sections that have one.
 */
export function ReportSection({
  id,
  title,
  description,
  sourceNote,
  actions,
  className,
  children,
}: {
  id: ReportSectionId;
  title: string;
  description?: React.ReactNode;
  sourceNote?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card id={id} data-report-section={id} className={cn("scroll-mt-28", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
          {sourceNote ? (
            <p className="mt-1.5 text-xs text-[var(--acton-muted)]">{sourceNote}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 print:hidden">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

/**
 * One visual language for every "nothing here" state.
 *
 * - `no-data`: sources returned nothing; dashed + muted so the gap reads as a gap.
 * - `manual-review`: there is an action for a human (configure a rule, verify in
 *   person, open an official viewer); amber so it reads as a to-do, not a failure.
 */
export function ReportNotice({
  variant = "no-data",
  className,
  children,
}: {
  variant?: "no-data" | "manual-review";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md px-3 py-3 text-sm print:break-inside-avoid",
        variant === "manual-review"
          ? "border border-amber-200 bg-amber-50/70 text-[var(--acton-navy)]"
          : "border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-[var(--acton-muted)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Small muted print-safe caveat/disclaimer paragraph used at the foot of sections. */
export function ReportFootnote({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("text-xs leading-snug text-[var(--acton-muted)]", className)}>{children}</p>
  );
}

/** Responsive grid for label/value facts. */
export function ReportFactGrid({
  columns = 3,
  className,
  children,
}: {
  columns?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid gap-4 sm:grid-cols-2 print:gap-3",
        // Print has ~816px of width but no `lg` breakpoint, so ask for the dense
        // column count explicitly.
        columns === 3 ? "lg:grid-cols-3 print:grid-cols-3" : null,
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** Single label/value fact. `children` holds caveats, source notes, viewer links. */
export function ReportFact({
  label,
  value,
  className,
  children,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("border-t border-[var(--acton-border)] pt-3", className)}>
      <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">{value}</dd>
      {children}
    </div>
  );
}

/** Section-level caveat/source link line, matched to `ReportFact` typography. */
export function ReportFactNote({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("mt-1 text-xs leading-snug text-[var(--acton-muted)]", className)}>
      {children}
    </p>
  );
}
