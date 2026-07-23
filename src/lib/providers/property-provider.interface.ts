import type { PropertyLookupInput } from "@/lib/research/types";

export type PropertyProviderResult = {
  provider: string;
  apn?: string | null;
  attomId?: string | null;
  lotSquareFootage?: number | null;
  livingAreaSquareFootage?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  yearBuilt?: number | null;
  estimatedValue?: number | null;
  assessedValue?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
  ownerName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raw?: unknown;
};

export interface PropertyProvider {
  readonly key: string;
  readonly name: string;
  getProperty(input: PropertyLookupInput): Promise<PropertyProviderResult | null>;
}
