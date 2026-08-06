import { cn } from "@/lib/utils";
import type { ReportSummaryChip } from "@/lib/research/report-view-model";

/**
 * At-a-glance strip under the report title. Screen-only: print keeps the card
 * stack, where every one of these values appears in its own section.
 *
 * Styling carries exactly two states — has a value, or does not. Severity stays
 * where the sections define it; a chip never colors a flood zone or fire zone.
 */
export function ReportSummaryChips({ chips }: { chips: ReportSummaryChip[] }) {
  if (chips.length === 0) return null;

  return (
    <section
      id="at-a-glance"
      data-report-section="at-a-glance"
      aria-labelledby="at-a-glance-heading"
      className="scroll-mt-28 print:hidden"
    >
      <h2
        id="at-a-glance-heading"
        className="text-xs font-semibold tracking-[0.14em] text-[var(--acton-muted)] uppercase"
      >
        At a glance
      </h2>
      <p className="mt-1 text-sm text-[var(--acton-muted)]">
        The facts most often asked for in a PEM. Select one to jump to the full section and its
        caveats.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.id} className="min-w-0">
            <a
              href={`#${chip.targetId}`}
              title={chip.fullValue}
              data-chip={chip.id}
              data-chip-has-value={chip.hasValue ? "true" : "false"}
              className={cn(
                "block h-full max-w-[15rem] rounded-md border px-3 py-2 transition-colors",
                "hover:border-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
                chip.hasValue
                  ? "border-[var(--acton-border)] bg-white"
                  : "border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)]",
              )}
            >
              <span className="block text-[11px] tracking-wide text-[var(--acton-muted)] uppercase">
                {chip.label}
              </span>
              <span
                className={cn(
                  "mt-0.5 block text-sm font-semibold",
                  chip.hasValue ? "text-[var(--acton-navy)]" : "text-[var(--acton-muted)]",
                )}
              >
                {chip.value}
              </span>
              {chip.note ? (
                <span className="mt-1 block text-[10px] leading-snug text-[var(--acton-muted)]">
                  {chip.note}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
