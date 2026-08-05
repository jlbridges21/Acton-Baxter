import type { HydrantSourceKey } from "./config";

export type HydrantConfidenceLabel = "official_city_gis" | "official_local_gis" | "osm_community";

export type HydrantCandidate = {
  longitude: number;
  latitude: number;
  distanceFt: number;
  sourceKey: HydrantSourceKey;
  sourceName: string;
  confidenceLabel: HydrantConfidenceLabel;
  /** Human-readable confidence / coverage note for UI. */
  sourceLabel: string;
  sourceUrl: string | null;
  externalId: string | null;
};

export type HydrantLookupResult =
  | {
      status: "ok";
      hydrant: HydrantCandidate;
      attemptedSources: HydrantSourceKey[];
      responseTimeMs: number | null;
    }
  | {
      status: "no_data";
      hydrant: null;
      attemptedSources: HydrantSourceKey[];
      statusMessage: string;
      manualLookupUrl: string | null;
      responseTimeMs: number | null;
    };
