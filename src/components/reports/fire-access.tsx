import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import {
  HYDRANT_PULL_DISTANCE_CAVEAT,
  formatHydrantDistanceDisplay,
  type SprinklerIndicator,
} from "@/lib/research/fire-access";

export type FireAccessHydrantView = {
  status: "ok" | "no_data";
  distanceFt: number | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  statusMessage: string | null;
  manualLookupUrl: string | null;
};

export function FireAccessSection({
  hydrant,
  sprinkler,
}: {
  hydrant: FireAccessHydrantView;
  sprinkler: SprinklerIndicator;
}) {
  return (
    <Card>
      <CardTitle>Fire access</CardTitle>
      <p className="mt-1 text-sm text-[var(--acton-muted)]">
        Mapped hydrant distance and jurisdiction sprinkler threshold (preparation material only).
      </p>

      <div className="mt-4 space-y-4">
        <div className="border-t border-[var(--acton-border)] pt-3">
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Nearest mapped hydrant
          </dt>
          {hydrant.status === "ok" && hydrant.distanceFt != null && hydrant.sourceLabel ? (
            <>
              <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
                {formatHydrantDistanceDisplay({
                  distanceFt: hydrant.distanceFt,
                  sourceLabel: hydrant.sourceLabel,
                })}
              </dd>
              <p className="mt-1 text-xs leading-snug text-[var(--acton-muted)]">
                {HYDRANT_PULL_DISTANCE_CAVEAT}
              </p>
              {hydrant.sourceUrl ? (
                <a
                  href={hydrant.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--acton-navy)] underline print:hidden"
                >
                  Source layer
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </>
          ) : (
            <>
              <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
                No hydrant data available for this area
              </dd>
              <p className="mt-1 text-xs leading-snug text-[var(--acton-muted)]">
                {hydrant.statusMessage ??
                  "No mapped hydrant was found nearby from official GIS or OpenStreetMap."}{" "}
                {HYDRANT_PULL_DISTANCE_CAVEAT}
              </p>
              {hydrant.manualLookupUrl ? (
                <a
                  href={hydrant.manualLookupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--acton-navy)] underline print:hidden"
                >
                  Manual map lookup
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </>
          )}
        </div>

        <div className="border-t border-[var(--acton-border)] pt-3">
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Sprinkler distance indicator
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
            {sprinkler.headline}
          </dd>
          <p className="mt-1 text-xs leading-snug text-[var(--acton-muted)]">{sprinkler.detail}</p>
          {sprinkler.state === "no_rule" ? (
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              Configure the rule at{" "}
              <Link href="/admin/jurisdictions" className="font-medium underline">
                /admin/jurisdictions
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
