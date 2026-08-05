import type { PropertyLookupInput } from "@/lib/research/types";

export type HazardLookupResult = {
  floodZone?: string | null;
  fireZone?: string | null;
  /** WUI classification display text; always includes caveat language when present. */
  wuiClassification?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  viewerUrl?: string | null;
  status?: "ok" | "no_coverage" | "error" | "manual_review";
  statusMessage?: string | null;
  responseTimeMs?: number | null;
};

export interface HazardProvider {
  readonly key: string;
  readonly name: string;
  getHazards(input: PropertyLookupInput): Promise<HazardLookupResult | null>;
}
