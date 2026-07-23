import { Card, CardTitle } from "@/components/ui/card";
import type { PropertyFactRow } from "@/lib/research/db-types";

function valueFor(facts: PropertyFactRow[], key: string) {
  const fact = facts.find((item) => item.field_key === key);
  return fact?.normalized_value_text ?? "—";
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
    { label: "Flood zone", key: "flood_zone" },
    { label: "Fire zone", key: "fire_zone" },
  ];

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
