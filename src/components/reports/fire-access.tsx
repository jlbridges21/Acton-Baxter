import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ReportFact, ReportFactNote, ReportSection } from "./report-section";
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
    <ReportSection
      id="fire-access"
      title="Fire access"
      description="How far the nearest mapped hydrant is, and whether that distance alone would trigger the jurisdiction's sprinkler threshold."
      sourceNote="Source: official fire-hydrant GIS where published, otherwise OpenStreetMap; sprinkler threshold from admin-maintained jurisdiction rules. Preparation material only, not a code determination."
    >
      <dl className="space-y-4">
        <ReportFact
          label="Nearest mapped hydrant"
          value={
            hydrant.status === "ok" && hydrant.distanceFt != null && hydrant.sourceLabel
              ? formatHydrantDistanceDisplay({
                  distanceFt: hydrant.distanceFt,
                  sourceLabel: hydrant.sourceLabel,
                })
              : "No hydrant data available for this area"
          }
        >
          {hydrant.status === "ok" && hydrant.distanceFt != null && hydrant.sourceLabel ? (
            <>
              <ReportFactNote>{HYDRANT_PULL_DISTANCE_CAVEAT}</ReportFactNote>
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
              <ReportFactNote>
                {hydrant.statusMessage ??
                  "No mapped hydrant was found nearby from official GIS or OpenStreetMap."}{" "}
                {HYDRANT_PULL_DISTANCE_CAVEAT}
              </ReportFactNote>
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
        </ReportFact>

        <ReportFact label="Sprinkler distance indicator" value={sprinkler.headline}>
          <ReportFactNote>{sprinkler.detail}</ReportFactNote>
          {sprinkler.state === "no_rule" ? (
            <ReportFactNote>
              Configure the rule at{" "}
              <Link href="/admin/jurisdictions" className="font-medium underline">
                /admin/jurisdictions
              </Link>
              .
            </ReportFactNote>
          ) : null}
        </ReportFact>
      </dl>
    </ReportSection>
  );
}
