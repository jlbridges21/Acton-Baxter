import {
  getJurisdictionDisplayName,
  listJurisdictionRules,
  type SupportedJurisdictionKey,
} from "@/lib/jurisdictions";
import { HYDRANT_PULL_DISTANCE_CAVEAT } from "@/lib/providers/hydrants/config";

export const FIRE_SPRINKLER_RULE_KEY = "fire_sprinkler_hydrant_distance_max_ft" as const;

export type SprinklerIndicatorState =
  "within_threshold" | "exceeds_threshold" | "rule_no_hydrant" | "no_rule";

export type SprinklerIndicator = {
  state: SprinklerIndicatorState;
  headline: string;
  detail: string;
  thresholdFt: number | null;
  sourceCitation: string | null;
  distanceFt: number | null;
  jurisdictionName: string;
};

export type FireAccessHydrantSummary = {
  status: "ok" | "no_data";
  distanceFt: number | null;
  displayText: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  statusMessage: string | null;
  manualLookupUrl: string | null;
};

const ONE_FACTOR_NOTE =
  "Hydrant distance is one sprinkler-requirement factor among several (dwelling size, available flow, local amendments). This is preparation material, not a code determination.";

function formatFeet(value: number): string {
  return `~${Math.round(value).toLocaleString("en-US")} ft`;
}

export function buildSprinklerIndicator(input: {
  jurisdictionKey: SupportedJurisdictionKey | null;
  jurisdictionName?: string | null;
  distanceFt: number | null;
  thresholdFt: number | null;
  sourceCitation: string | null;
}): SprinklerIndicator {
  const jurisdictionName =
    input.jurisdictionName?.trim() ||
    getJurisdictionDisplayName(input.jurisdictionKey) ||
    "this jurisdiction";

  if (input.thresholdFt == null || !input.sourceCitation?.trim()) {
    return {
      state: "no_rule",
      headline: `No fire-sprinkler hydrant-distance rule configured for ${jurisdictionName}`,
      detail: `An admin can add fire_sprinkler_hydrant_distance_max_ft with a required source citation at /admin/jurisdictions. ${ONE_FACTOR_NOTE}`,
      thresholdFt: null,
      sourceCitation: null,
      distanceFt: input.distanceFt,
      jurisdictionName,
    };
  }

  const citation = input.sourceCitation.trim();
  const threshold = input.thresholdFt;

  if (input.distanceFt == null) {
    return {
      state: "rule_no_hydrant",
      headline: `Jurisdiction threshold is ${threshold.toLocaleString("en-US")} ft (${citation})`,
      detail: `No nearby mapped hydrant distance is available — measure pull distance on site and compare to this threshold. ${HYDRANT_PULL_DISTANCE_CAVEAT} ${ONE_FACTOR_NOTE}`,
      thresholdFt: threshold,
      sourceCitation: citation,
      distanceFt: null,
      jurisdictionName,
    };
  }

  if (input.distanceFt <= threshold) {
    return {
      state: "within_threshold",
      headline: `Straight-line distance is within the ${threshold.toLocaleString("en-US")} ft threshold (${citation})`,
      detail: `But confirm pull distance on site, since path-of-travel distance is longer and governs. ${ONE_FACTOR_NOTE}`,
      thresholdFt: threshold,
      sourceCitation: citation,
      distanceFt: input.distanceFt,
      jurisdictionName,
    };
  }

  return {
    state: "exceeds_threshold",
    headline: `Straight-line distance already exceeds the ${threshold.toLocaleString("en-US")} ft threshold (${citation})`,
    detail: `Fire sprinklers are likely required; confirm with ${jurisdictionName}. ${HYDRANT_PULL_DISTANCE_CAVEAT} ${ONE_FACTOR_NOTE}`,
    thresholdFt: threshold,
    sourceCitation: citation,
    distanceFt: input.distanceFt,
    jurisdictionName,
  };
}

export async function loadSprinklerThreshold(
  jurisdictionKey: SupportedJurisdictionKey | null,
): Promise<{ thresholdFt: number | null; sourceCitation: string | null }> {
  if (!jurisdictionKey) return { thresholdFt: null, sourceCitation: null };
  const rules = await listJurisdictionRules({ jurisdictionKey });
  const rule = rules.find((row) => row.rule_key === FIRE_SPRINKLER_RULE_KEY && !row.zone_key);
  if (!rule) return { thresholdFt: null, sourceCitation: null };
  if (rule.value_json.kind !== "quantity") {
    return { thresholdFt: null, sourceCitation: rule.source_citation };
  }
  return {
    thresholdFt: rule.value_json.value,
    sourceCitation: rule.source_citation,
  };
}

export function formatHydrantDistanceDisplay(input: {
  distanceFt: number;
  sourceLabel: string;
}): string {
  return `${formatFeet(input.distanceFt)} straight-line (source: ${input.sourceLabel})`;
}

export { HYDRANT_PULL_DISTANCE_CAVEAT, ONE_FACTOR_NOTE };
