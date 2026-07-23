import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SiteObservationRow } from "@/lib/research/db-types";

export function SiteObservations({ observations }: { observations: SiteObservationRow[] }) {
  if (observations.length === 0) return null;

  return (
    <Card>
      <CardTitle>Preliminary site observations</CardTitle>
      <CardDescription className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
        Preliminary observations based on public records, maps, and imagery. These are not verified
        measurements or a feasibility determination.
      </CardDescription>
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
    </Card>
  );
}
