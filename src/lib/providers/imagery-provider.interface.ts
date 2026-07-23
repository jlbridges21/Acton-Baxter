import type { PropertyLookupInput } from "@/lib/research/types";

export type ImageryResult = {
  aerialUrl?: string | null;
  streetViewUrl?: string | null;
  sourceName: string;
};

export interface ImageryProvider {
  readonly key: string;
  readonly name: string;
  getImagery(input: PropertyLookupInput): Promise<ImageryResult | null>;
}
