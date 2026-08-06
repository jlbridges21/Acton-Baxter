import area from "@turf/area";
import buffer from "@turf/buffer";
import { multiPolygon, polygon } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { selectRulesForZoning } from "@/lib/jurisdictions/select-rules";
import type { JurisdictionRule } from "@/lib/jurisdictions/types";

export const SETBACK_FRONT_KEY = "adu_setback_front_ft" as const;
export const SETBACK_SIDE_KEY = "adu_setback_side_ft" as const;
export const SETBACK_REAR_KEY = "adu_setback_rear_ft" as const;
export const ADU_MAX_SIZE_KEY = "adu_max_size_sqft" as const;

/** Shown wherever the approximate envelope appears (map caption, area figure, section). */
export const BUILDABLE_ENVELOPE_DISCLAIMER =
  "Approximate only — side/rear setbacks applied uniformly; the larger front-yard setback (street-facing) is not modeled and must be applied by eye / on site. Does not account for easements, existing structures, slopes, trees, or utilities. Not a survey or zoning determination.";

export const FRONT_YARD_NOT_MODELED_NOTE =
  "Front-yard setback is listed for reference but is not drawn into the envelope — identifying the street-facing edge automatically is unreliable.";

export const DEGENERATE_ENVELOPE_MESSAGE =
  "Setbacks may consume most of this lot — site-specific analysis required.";

export const ENVELOPE_INVALID_FALLBACK_MESSAGE =
  "Could not draw a clean inset from this parcel geometry — showing setback rules only.";

const SQ_METERS_TO_SQ_FT = 10.76391041671;
const MIN_ENVELOPE_AREA_SQ_FT = 25;

export type SetbackRuleSlice = {
  feet: number | null;
  citation: string | null;
  zoneKey: string | null;
};

export type SetbackRulesSummary = {
  front: SetbackRuleSlice;
  side: SetbackRuleSlice;
  rear: SetbackRuleSlice;
  /** Uniform inset used for the envelope (max of available side/rear). */
  insetFeet: number | null;
  usedZoneSpecificRules: boolean;
  fellBackToGeneralRules: boolean;
  scopeLabel: "zone-specific" | "general" | "none";
  zoning: string | null;
};

export type MaxSizeRuleSlice = {
  sqFt: number;
  citation: string;
  zoneKey: string | null;
};

export type BuildableEnvelopeStatus =
  "ok" | "degenerate" | "rules_only" | "no_side_rear_rules" | "no_geometry" | "no_rules";

export type BuildableEnvelopeGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type BuildableEnvelopeResult = {
  status: BuildableEnvelopeStatus;
  setbacks: SetbackRulesSummary;
  maxSize: MaxSizeRuleSlice | null;
  geometry: BuildableEnvelopeGeometry | null;
  areaSqFt: number | null;
  insetFeet: number | null;
  statusMessage: string | null;
  disclaimer: string;
  frontYardNote: string;
};

function emptySetback(): SetbackRuleSlice {
  return { feet: null, citation: null, zoneKey: null };
}

function quantityFeet(rule: JurisdictionRule | undefined): SetbackRuleSlice {
  if (!rule) return emptySetback();
  if (rule.value_json.kind !== "quantity" || !Number.isFinite(rule.value_json.value)) {
    return { feet: null, citation: rule.source_citation, zoneKey: rule.zone_key };
  }
  return {
    feet: rule.value_json.value,
    citation: rule.source_citation,
    zoneKey: rule.zone_key,
  };
}

function findRule(rules: JurisdictionRule[], key: string): JurisdictionRule | undefined {
  return rules.find((rule) => rule.rule_key === key);
}

export function extractSetbackRulesSummary(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): SetbackRulesSummary {
  const { selected, usedZoneSpecificRules, fellBackToGeneralRules } = selectRulesForZoning(
    rules,
    zoning,
  );
  const front = quantityFeet(findRule(selected, SETBACK_FRONT_KEY));
  const side = quantityFeet(findRule(selected, SETBACK_SIDE_KEY));
  const rear = quantityFeet(findRule(selected, SETBACK_REAR_KEY));

  const insetCandidates = [side.feet, rear.feet].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  const insetFeet = insetCandidates.length > 0 ? Math.max(...insetCandidates) : null;

  let scopeLabel: SetbackRulesSummary["scopeLabel"] = "none";
  if (front.feet != null || side.feet != null || rear.feet != null) {
    scopeLabel = usedZoneSpecificRules ? "zone-specific" : "general";
  }

  return {
    front,
    side,
    rear,
    insetFeet,
    usedZoneSpecificRules,
    fellBackToGeneralRules,
    scopeLabel,
    zoning: zoning?.trim() || null,
  };
}

export function extractMaxSizeRule(
  rules: JurisdictionRule[],
  zoning: string | null | undefined,
): MaxSizeRuleSlice | null {
  const { selected } = selectRulesForZoning(rules, zoning);
  const rule = findRule(selected, ADU_MAX_SIZE_KEY);
  if (!rule || rule.value_json.kind !== "quantity" || !Number.isFinite(rule.value_json.value)) {
    return null;
  }
  return {
    sqFt: rule.value_json.value,
    citation: rule.source_citation,
    zoneKey: rule.zone_key,
  };
}

function isFinitePosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length < 3) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function extractPolygons(
  geometry: { type?: unknown; coordinates?: unknown } | null | undefined,
): Position[][][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];

  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates as unknown[])
      .filter(Array.isArray)
      .map((ring) => closeRing((ring as unknown[]).filter(isFinitePosition)))
      .filter((ring) => ring.length >= 4);
    return rings.length > 0 ? [rings] : [];
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as unknown[])
      .filter(Array.isArray)
      .map((polygonCoords) =>
        (polygonCoords as unknown[])
          .filter(Array.isArray)
          .map((ring) => closeRing((ring as unknown[]).filter(isFinitePosition)))
          .filter((ring) => ring.length >= 4),
      )
      .filter((rings) => rings.length > 0);
  }

  return [];
}

function featureFromPolygons(polygons: Position[][][]): Feature<Polygon | MultiPolygon> | null {
  if (polygons.length === 0) return null;
  if (polygons.length === 1) {
    return polygon(polygons[0]!);
  }
  return multiPolygon(polygons);
}

function geometryFromFeature(
  feature: Feature<Polygon | MultiPolygon | null> | null | undefined,
): BuildableEnvelopeGeometry | null {
  if (!feature?.geometry || feature.geometry.type === null) return null;
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates };
  }
  if (geom.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geom.coordinates };
  }
  return null;
}

function isUsableEnvelopeGeometry(geometry: BuildableEnvelopeGeometry | null): boolean {
  if (!geometry) return false;
  try {
    const polygons = extractPolygons(geometry);
    if (polygons.length === 0) return false;
    const feature = featureFromPolygons(polygons);
    if (!feature) return false;
    const sqFt = area(feature) * SQ_METERS_TO_SQ_FT;
    return Number.isFinite(sqFt) && sqFt >= MIN_ENVELOPE_AREA_SQ_FT;
  } catch {
    return false;
  }
}

/**
 * Deterministic approximate buildable envelope: uniform inward offset using
 * side/rear setbacks only. Front setback is never applied to the geometry.
 */
export function computeApproximateBuildableEnvelope(input: {
  geometry: { type?: unknown; coordinates?: unknown } | null | undefined;
  rules: JurisdictionRule[];
  zoning?: string | null;
}): BuildableEnvelopeResult {
  const setbacks = extractSetbackRulesSummary(input.rules, input.zoning);
  const maxSize = extractMaxSizeRule(input.rules, input.zoning);
  const base = {
    setbacks,
    maxSize,
    disclaimer: BUILDABLE_ENVELOPE_DISCLAIMER,
    frontYardNote: FRONT_YARD_NOT_MODELED_NOTE,
  };

  const hasAnySetback =
    setbacks.front.feet != null || setbacks.side.feet != null || setbacks.rear.feet != null;

  if (!hasAnySetback) {
    return {
      ...base,
      status: "no_rules",
      geometry: null,
      areaSqFt: null,
      insetFeet: null,
      statusMessage:
        "No ADU setback rules configured — an admin can add them at /admin/jurisdictions.",
    };
  }

  if (setbacks.insetFeet == null) {
    return {
      ...base,
      status: "no_side_rear_rules",
      geometry: null,
      areaSqFt: null,
      insetFeet: null,
      statusMessage:
        "Front setback is configured, but side/rear setbacks are required to draw an approximate envelope.",
    };
  }

  const polygons = extractPolygons(input.geometry);
  if (polygons.length === 0) {
    return {
      ...base,
      status: "no_geometry",
      geometry: null,
      areaSqFt: null,
      insetFeet: setbacks.insetFeet,
      statusMessage:
        "Parcel geometry is unavailable — setback rules shown without an envelope map.",
    };
  }

  try {
    const bufferedPolygons: Position[][][] = [];
    for (const rings of polygons) {
      const feature = polygon(rings);
      const buffered = buffer(feature, -setbacks.insetFeet, { units: "feet" });
      const geom = geometryFromFeature(buffered as Feature<Polygon | MultiPolygon | null>);
      if (!geom) continue;
      bufferedPolygons.push(...extractPolygons(geom));
    }

    if (bufferedPolygons.length === 0) {
      return {
        ...base,
        status: "degenerate",
        geometry: null,
        areaSqFt: null,
        insetFeet: setbacks.insetFeet,
        statusMessage: DEGENERATE_ENVELOPE_MESSAGE,
      };
    }

    const envelopeFeature = featureFromPolygons(bufferedPolygons);
    if (!envelopeFeature || !isUsableEnvelopeGeometry(geometryFromFeature(envelopeFeature))) {
      return {
        ...base,
        status: "degenerate",
        geometry: null,
        areaSqFt: null,
        insetFeet: setbacks.insetFeet,
        statusMessage: DEGENERATE_ENVELOPE_MESSAGE,
      };
    }

    const envelopeGeometry = geometryFromFeature(envelopeFeature)!;
    const areaSqFt = Math.round(area(envelopeFeature) * SQ_METERS_TO_SQ_FT);

    return {
      ...base,
      status: "ok",
      geometry: envelopeGeometry,
      areaSqFt,
      insetFeet: setbacks.insetFeet,
      statusMessage: null,
    };
  } catch {
    return {
      ...base,
      status: "rules_only",
      geometry: null,
      areaSqFt: null,
      insetFeet: setbacks.insetFeet,
      statusMessage: ENVELOPE_INVALID_FALLBACK_MESSAGE,
    };
  }
}

export function formatEnvelopeAreaDisplay(areaSqFt: number): string {
  return `approximate buildable envelope: ~${Math.round(areaSqFt).toLocaleString("en-US")} sq ft (side/rear setbacks only)`;
}

export function formatMaxSizeDisplay(maxSize: MaxSizeRuleSlice): string {
  return `jurisdiction max detached ADU size: ${Math.round(maxSize.sqFt).toLocaleString("en-US")} sq ft (${maxSize.citation})`;
}
