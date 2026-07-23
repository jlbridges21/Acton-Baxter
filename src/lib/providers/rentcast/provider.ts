import type { PropertyLookupInput } from "@/lib/research/types";
import type { PropertyProvider, PropertyProviderResult } from "../property-provider.interface";
import { extractRentCastProperties, rentCastRequest } from "./client";
import { normalizeRentCastProperty, selectBestRentCastMatch } from "./normalizer";
import type { RentCastNormalizedProperty, RentCastRequestResult } from "./types";

export type RentCastLookupResult = {
  property: RentCastNormalizedProperty | null;
  request: RentCastRequestResult<unknown>;
  status: "active" | "manual_review" | "unavailable" | "error";
  statusMessage: string | null;
};

export async function lookupRentCastProperty(
  input: PropertyLookupInput,
): Promise<RentCastLookupResult> {
  const address = input.standardizedAddress ?? input.address;
  const request = await rentCastRequest("properties", { address });
  const candidates = extractRentCastProperties(request.data).map((property) =>
    normalizeRentCastProperty(property, input),
  );
  const best = selectBestRentCastMatch(candidates);

  if (!best) {
    return {
      property: null,
      request,
      status: candidates.length > 0 ? "manual_review" : "unavailable",
      statusMessage:
        candidates.length > 0
          ? "RentCast returned properties but none matched the address confidently."
          : (request.statusMessage ?? "RentCast returned no matching property."),
    };
  }

  return {
    property: best,
    request,
    status: "active",
    statusMessage: null,
  };
}

export class RentCastProvider implements PropertyProvider {
  readonly key = "rentcast";
  readonly name = "RentCast";

  async getProperty(input: PropertyLookupInput): Promise<PropertyProviderResult | null> {
    const result = await lookupRentCastProperty(input);
    if (!result.property) return null;
    const property = result.property;
    return {
      provider: this.name,
      apn: null,
      lotSquareFootage: property.lotSquareFootage,
      livingAreaSquareFootage: property.livingAreaSquareFootage,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      yearBuilt: property.yearBuilt,
      estimatedValue: null,
      assessedValue: property.assessedValue,
      lastSaleDate: property.lastSaleDate,
      lastSalePrice: property.lastSalePrice,
      ownerName: property.ownerNames,
      latitude: property.latitude,
      longitude: property.longitude,
      raw: property.raw,
    };
  }
}
