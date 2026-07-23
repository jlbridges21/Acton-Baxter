import type { PropertyLookupInput } from "@/lib/research/types";

export type HazardLookupResult = {
  floodZone?: string | null;
  fireZone?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
};

export interface HazardProvider {
  readonly key: string;
  readonly name: string;
  getHazards(input: PropertyLookupInput): Promise<HazardLookupResult | null>;
}
