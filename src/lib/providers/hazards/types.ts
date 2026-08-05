export type HazardLayerStatus = "ok" | "no_coverage" | "error" | "manual_review";

export type HazardLayerResult = {
  status: HazardLayerStatus;
  /** Short machine-ish value (zone code / class). */
  value: string | null;
  /** User-facing display string (may include dates / caveats). */
  displayText: string | null;
  sourceName: string;
  sourceUrl: string;
  viewerUrl: string;
  responseTimeMs: number | null;
  statusMessage: string | null;
  details: Record<string, string | number | boolean | null | undefined>;
};

export type PropertyHazardsLookup = {
  flood: HazardLayerResult;
  fire: HazardLayerResult;
  wui: HazardLayerResult;
};
