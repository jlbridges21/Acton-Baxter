import type { PropertyLookupInput } from "@/lib/research/types";
import type { PropertyProvider, PropertyProviderResult } from "../property-provider.interface";
import { attomRequest, extractAttomProperties } from "./client";
import { AttomError } from "./errors";
import { mergeAttomPackages, normalizeAttomProperty } from "./normalizer";
import type { AttomNormalizedProperty, AttomRequestResult } from "./types";

export type AttomLookupResult = {
  property: AttomNormalizedProperty | null;
  packageResults: AttomRequestResult<unknown>[];
  statusMessage: string | null;
};

function splitAddress(input: PropertyLookupInput): { address1: string; address2: string } {
  const address = input.standardizedAddress ?? input.address;
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      address1: parts[0]!,
      address2: parts.slice(1).join(", "),
    };
  }
  return {
    address1: address,
    address2: [input.city, input.state, input.zipCode].filter(Boolean).join(", "),
  };
}

async function safePackage(
  packagePath: string,
  query: Record<string, string | number | undefined>,
): Promise<AttomRequestResult<unknown>> {
  try {
    return await attomRequest(packagePath, query);
  } catch (error) {
    if (error instanceof AttomError && (error.statusCode === 401 || error.statusCode === 403)) {
      throw error;
    }
    return {
      data: null,
      responseTimeMs: 0,
      httpStatus: error instanceof AttomError ? (error.statusCode ?? 500) : 500,
      packagePath,
      unavailable: true,
      statusMessage:
        error instanceof Error ? error.message : `ATTOM package ${packagePath} unavailable`,
    };
  }
}

export async function lookupAttomProperty(input: PropertyLookupInput): Promise<AttomLookupResult> {
  const { address1, address2 } = splitAddress(input);
  const detail = await attomRequest("property/detail", { address1, address2 });
  const properties = extractAttomProperties(detail.data);
  if (properties.length === 0) {
    return {
      property: null,
      packageResults: [detail],
      statusMessage: detail.statusMessage ?? "ATTOM returned no matching property.",
    };
  }

  const first = normalizeAttomProperty(properties[0]!);
  const attomId = first.identity.attomId;
  const idQuery = attomId ? { attomid: attomId } : { address1, address2 };

  const supplemental = await Promise.all([
    safePackage("assessment/detail", idQuery),
    safePackage("avm/detail", idQuery),
    safePackage("sale/detail", idQuery),
    safePackage("property/detailowner", idQuery),
    safePackage("saleshistory/detail", idQuery),
  ]);

  const extras = supplemental
    .filter((result) => !result.unavailable)
    .flatMap((result) => extractAttomProperties(result.data))
    .map((property) => normalizeAttomProperty(property));

  const merged = mergeAttomPackages(first, extras);

  return {
    property: merged,
    packageResults: [detail, ...supplemental],
    statusMessage: null,
  };
}

export class AttomProvider implements PropertyProvider {
  readonly key = "attom";
  readonly name = "ATTOM";

  async getProperty(input: PropertyLookupInput): Promise<PropertyProviderResult | null> {
    const result = await lookupAttomProperty(input);
    if (!result.property) return null;
    const property = result.property;
    return {
      provider: this.name,
      apn: property.identity.apn,
      attomId: property.identity.attomId,
      lotSquareFootage: property.lotSquareFootage,
      livingAreaSquareFootage: property.livingAreaSquareFootage,
      bedrooms: property.bedrooms,
      bathrooms: property.bathroomsTotal,
      yearBuilt: property.yearBuilt,
      estimatedValue: property.estimatedValue,
      assessedValue: property.assessedValueTotal,
      lastSaleDate: property.lastSaleDate,
      lastSalePrice: property.lastSaleAmount,
      ownerName: property.ownerNames,
      latitude: property.identity.latitude,
      longitude: property.identity.longitude,
      raw: property.raw,
    };
  }
}
