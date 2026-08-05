import { ExternalLink } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import type { PropertyFactRow } from "@/lib/research/db-types";
import { WUI_CAVEAT } from "@/lib/research/constants";

function factFor(facts: PropertyFactRow[], key: string) {
  return facts.find((item) => item.field_key === key) ?? null;
}

function valueFor(facts: PropertyFactRow[], key: string) {
  return factFor(facts, key)?.normalized_value_text ?? "—";
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
  const value = fact?.normalized_value_text ?? "—";
  const href = fact?.preferred_source_url ?? null;

  return (
    <div className="border-t border-[var(--acton-border)] pt-3">
      <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">{value}</dd>
      {caveat ? (
        <p className="mt-1 text-xs leading-snug text-[var(--acton-muted)]">{caveat}</p>
      ) : null}
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
    </div>
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
    <Card>
      <CardTitle>Planning and hazards</CardTitle>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="border-t border-[var(--acton-border)] pt-3">
            <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
              {item.label}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
              {valueFor(facts, item.key)}
            </dd>
          </div>
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
        <div className="border-t border-[var(--acton-border)] pt-3 sm:col-span-2 lg:col-span-3">
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Relevant overlays
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
            {overlays.length > 0 ? overlays.join("; ") : "None identified"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
