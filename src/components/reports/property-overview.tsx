"use client";

import { useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { PropertyFactRow, PropertySourceClaimRow } from "@/lib/research/db-types";
import { FOUNDATION_TYPE_VERIFY_NOTE } from "@/lib/research/constants";

function factValue(facts: PropertyFactRow[], key: string) {
  return facts.find((fact) => fact.field_key === key) ?? null;
}

function hasDisplayableValue(fact: PropertyFactRow | null) {
  if (!fact) return false;
  if (fact.normalized_value_number !== null) return true;
  if (fact.normalized_value_boolean !== null) return true;
  if (fact.normalized_value_text && fact.normalized_value_text.trim()) return true;
  return false;
}

function displayFact(fact: PropertyFactRow) {
  if (fact.normalized_value_number !== null && fact.unit === "USD") {
    return formatCurrency(fact.normalized_value_number);
  }
  if (fact.normalized_value_number !== null && fact.unit === "sq ft") {
    return `${formatNumber(fact.normalized_value_number)} sq ft`;
  }
  if (fact.field_key === "last_sale_date") {
    return formatDate(fact.normalized_value_text);
  }
  if (fact.normalized_value_text) return fact.normalized_value_text;
  if (fact.normalized_value_number !== null) return formatNumber(fact.normalized_value_number);
  if (fact.normalized_value_boolean !== null) return fact.normalized_value_boolean ? "Yes" : "No";
  return "Not available";
}

const OVERVIEW_ITEMS = [
  { label: "Lot size", key: "lot_sq_ft", importantMissing: true },
  { label: "House square footage", key: "living_area_sq_ft", importantMissing: true },
  { label: "Bedrooms", key: "bedrooms", importantMissing: true },
  { label: "Bathrooms", key: "bathrooms", importantMissing: true },
  { label: "Stories", key: "stories", importantMissing: false },
  { label: "Year built", key: "year_built", importantMissing: true },
  { label: "Property type", key: "property_type", importantMissing: true },
  { label: "Foundation type", key: "foundation_type", importantMissing: false },
  { label: "Building count", key: "building_count", importantMissing: false },
  { label: "Pool", key: "pool", importantMissing: false },
  { label: "Estimated value", key: "estimated_value", importantMissing: false },
  { label: "Assessed value", key: "assessed_value", importantMissing: false },
  { label: "Last sale date", key: "last_sale_date", importantMissing: false },
  { label: "Last sale price", key: "last_sale_price", importantMissing: false },
] as const;

export function PropertyOverview({
  facts,
  claims,
}: {
  facts: PropertyFactRow[];
  claims: PropertySourceClaimRow[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const availableItems = OVERVIEW_ITEMS.filter((item) =>
    hasDisplayableValue(factValue(facts, item.key)),
  );
  const missingImportant = OVERVIEW_ITEMS.filter(
    (item) => item.importantMissing && !hasDisplayableValue(factValue(facts, item.key)),
  );

  if (availableItems.length === 0 && missingImportant.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardTitle>Property overview</CardTitle>
      {availableItems.length > 0 ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {availableItems.map((item) => {
            const fact = factValue(facts, item.key)!;
            const fieldClaims = claims.filter((claim) => claim.field_key === item.key);
            return (
              <div key={item.key} className="border-t border-[var(--acton-border)] pt-3">
                <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                  {item.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
                  {displayFact(fact)}
                </dd>
                {item.key === "foundation_type" ? (
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    {FOUNDATION_TYPE_VERIFY_NOTE}
                  </p>
                ) : null}
                {fact.preferred_source_name ? (
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    Source: {fact.preferred_source_name}
                  </p>
                ) : null}
                {fieldClaims.length > 1 ? (
                  <button
                    type="button"
                    className="mt-1 text-xs font-semibold text-[var(--acton-navy)] underline print:hidden"
                    onClick={() => setExpanded(expanded === item.key ? null : item.key)}
                  >
                    {expanded === item.key ? "Hide sources" : "Show all sources"}
                  </button>
                ) : null}
                {expanded === item.key ? (
                  <ul className="mt-2 space-y-1 text-xs text-[var(--acton-muted)] print:hidden">
                    {fieldClaims.map((claim) => (
                      <li key={claim.id}>
                        {claim.source_name}: {claim.normalized_value ?? "—"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </dl>
      ) : null}

      {missingImportant.length > 0 ? (
        <div className="mt-4 border-t border-[var(--acton-border)] pt-3">
          <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Missing information
          </p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {missingImportant.map((item) => item.label).join(", ")}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
