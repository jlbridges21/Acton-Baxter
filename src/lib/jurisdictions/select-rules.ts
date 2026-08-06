import type { JurisdictionRule } from "./types";

function normalizeZone(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Prefer zone-specific rules when zoning matches; otherwise jurisdiction-general
 * (zone_key is null). Never mix zone A rules into zone B.
 */
export function selectRulesForZoning(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): {
  selected: JurisdictionRule[];
  usedZoneSpecificRules: boolean;
  fellBackToGeneralRules: boolean;
} {
  const zoneNorm = normalizeZone(zoning);
  const general = rules.filter((rule) => !rule.zone_key);
  if (!zoneNorm) {
    return {
      selected: general,
      usedZoneSpecificRules: false,
      fellBackToGeneralRules: false,
    };
  }

  const zoneSpecific = rules.filter(
    (rule) => rule.zone_key && normalizeZone(rule.zone_key) === zoneNorm,
  );
  if (zoneSpecific.length > 0) {
    return {
      selected: zoneSpecific,
      usedZoneSpecificRules: true,
      fellBackToGeneralRules: false,
    };
  }

  return {
    selected: general,
    usedZoneSpecificRules: false,
    fellBackToGeneralRules: general.length > 0,
  };
}
