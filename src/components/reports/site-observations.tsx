import { ReportNotice, ReportSection } from "./report-section";
import { Badge } from "@/components/ui/badge";
import type { SiteObservationRow } from "@/lib/research/db-types";

export function SiteObservations({ observations }: { observations: SiteObservationRow[] }) {
  if (observations.length === 0) return null;

  return (
    <ReportSection
      id="observations"
      title="Site observations"
      description="What the imagery and public records suggest about the site, with a confidence label on each."
      sourceNote="Source: public records, GIS overlays, and aerial imagery."
    >
      <ReportNotice variant="manual-review">
        Preliminary observations only — not verified measurements and not a feasibility
        determination.
      </ReportNotice>
      <ul className="mt-4 space-y-3">
        {observations.map((observation) => (
          <li
            key={observation.id}
            className="border-t border-[var(--acton-border)] pt-3 print:break-inside-avoid"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--acton-navy)]">{observation.title}</p>
              <Badge tone="gray">{observation.confidence}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">{observation.description}</p>
          </li>
        ))}
      </ul>
    </ReportSection>
  );
}
