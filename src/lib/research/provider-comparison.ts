import { FIELD_KEYS } from "@/lib/research/constants";
import type { PropertyFact, SourceClaim } from "@/lib/research/schemas";

/** Fields both ATTOM and RentCast currently claim in the live pipeline. */
export const SHARED_LICENSED_FIELD_KEYS = [
  FIELD_KEYS.lotSqFt,
  FIELD_KEYS.livingAreaSqFt,
  FIELD_KEYS.bedrooms,
  FIELD_KEYS.bathrooms,
  FIELD_KEYS.stories,
  FIELD_KEYS.yearBuilt,
  FIELD_KEYS.propertyType,
  FIELD_KEYS.assessedValue,
  FIELD_KEYS.lastSaleDate,
  FIELD_KEYS.lastSalePrice,
  FIELD_KEYS.ownerName,
  FIELD_KEYS.ownerMailingAddress,
  FIELD_KEYS.subdivision,
  FIELD_KEYS.latitude,
  FIELD_KEYS.longitude,
] as const;

/**
 * Fields the live pipeline claims from ATTOM with no RentCast claim equivalent.
 * (APN also comes from county/city GIS when available — not purely ATTOM-dependent.)
 */
export const ATTOM_ONLY_CLAIMED_FIELD_KEYS = [
  FIELD_KEYS.foundationType,
  FIELD_KEYS.tractNumber,
  FIELD_KEYS.buildingCount,
  FIELD_KEYS.estimatedValue,
  FIELD_KEYS.apn,
] as const;

export type ProviderFieldComparisonRow = {
  fieldKey: string;
  fieldLabel: string;
  attomValue: string | null;
  rentcastValue: string | null;
  preferredSource: string | null;
};

function claimValue(claims: SourceClaim[], fieldKey: string, sourceName: string): string | null {
  const match = claims.find(
    (claim) =>
      claim.fieldKey === fieldKey &&
      claim.sourceName === sourceName &&
      Boolean(claim.normalizedValue?.trim()),
  );
  return match?.normalizedValue?.trim() ?? null;
}

/**
 * Side-by-side ATTOM vs RentCast values for shared fields — admin trial-window aid.
 * Returns [] when either provider contributed no values (single-source mode).
 */
export function buildProviderFieldComparison(
  claims: SourceClaim[],
  facts: PropertyFact[],
): ProviderFieldComparisonRow[] {
  const preferredByField = new Map(
    facts.map((fact) => [fact.fieldKey, fact.preferredSourceName ?? null]),
  );

  const rows: ProviderFieldComparisonRow[] = [];
  for (const fieldKey of SHARED_LICENSED_FIELD_KEYS) {
    const attomValue = claimValue(claims, fieldKey, "ATTOM");
    const rentcastValue = claimValue(claims, fieldKey, "RentCast");
    if (attomValue == null && rentcastValue == null) continue;
    const fact = facts.find((f) => f.fieldKey === fieldKey);
    rows.push({
      fieldKey,
      fieldLabel: fact?.fieldLabel ?? fieldKey,
      attomValue,
      rentcastValue,
      preferredSource: preferredByField.get(fieldKey) ?? null,
    });
  }
  return rows;
}
