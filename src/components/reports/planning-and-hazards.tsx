import { ExternalLink } from "lucide-react";
import { ReportFact, ReportFactGrid, ReportFactNote, ReportSection } from "./report-section";
import type { PropertyFactRow } from "@/lib/research/db-types";
import { WUI_CAVEAT } from "@/lib/research/constants";
import { NO_DATA_LABEL } from "@/lib/research/report-view-model";

function factFor(facts: PropertyFactRow[], key: string) {
  return facts.find((item) => item.field_key === key) ?? null;
}

function valueFor(facts: PropertyFactRow[], key: string) {
  return factFor(facts, key)?.normalized_value_text ?? NO_DATA_LABEL;
}

function HazardItem({
  label,
  factKey,
  facts,
  viewerLabel,
  caveat,
}: {
  label: string;
  factKey: string;
  facts: PropertyFactRow[];
  viewerLabel: string;
  caveat?: string | null;
}) {
  const fact = factFor(facts, factKey);
  const value = fact?.normalized_value_text ?? NO_DATA_LABEL;
  const href = fact?.preferred_source_url ?? null;

  return (
    <ReportFact label={label} value={value}>
      {caveat ? <ReportFactNote>{caveat}</ReportFactNote> : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--acton-navy)] underline print:hidden"
        >
          {viewerLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </ReportFact>
  );
}

export function PlanningAndHazards({
  facts,
  overlays,
}: {
  facts: PropertyFactRow[];
  overlays: string[];
}) {
  const items = [
    { label: "Zoning", key: "zoning" },
    { label: "General Plan designation", key: "general_plan" },
    { label: "Historic status", key: "historic_status" },
  ];

  const wuiFact = factFor(facts, "wui_classification");
  const showWuiCaveat = Boolean(wuiFact?.normalized_value_text);

  return (
    <ReportSection
      id="planning-hazards"
      title="Planning & hazards"
      description="The designations and hazard screens that shape what can be built and which reviews apply."
      sourceNote="Source: city/county GIS for planning designations; FEMA, CAL FIRE / OSFM, and CAL FIRE FRAP for hazard screens. Each is a screen, not a determination — verify with the linked official viewer."
    >
      <ReportFactGrid>
        {items.map((item) => (
          <ReportFact key={item.key} label={item.label} value={valueFor(facts, item.key)} />
        ))}
        <HazardItem
          label="Flood zone"
          factKey="flood_zone"
          facts={facts}
          viewerLabel="Verify on FEMA Map Service Center"
        />
        <HazardItem
          label="Fire hazard severity zone"
          factKey="fire_zone"
          facts={facts}
          viewerLabel="Verify on CAL FIRE / OSFM FHSZ maps"
        />
        <HazardItem
          label="Wildland-Urban Interface (WUI)"
          factKey="wui_classification"
          facts={facts}
          viewerLabel="Verify WUI with local jurisdiction / CAL FIRE"
          caveat={
            showWuiCaveat
              ? `Note: ${WUI_CAVEAT.charAt(0).toUpperCase()}${WUI_CAVEAT.slice(1)}.`
              : null
          }
        />
        <ReportFact
          label="Relevant overlays"
          value={overlays.length > 0 ? overlays.join("; ") : "None identified"}
          className="sm:col-span-2 lg:col-span-3"
        />
      </ReportFactGrid>
    </ReportSection>
  );
}
