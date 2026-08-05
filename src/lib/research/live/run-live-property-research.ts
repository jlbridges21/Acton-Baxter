import "server-only";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import distance from "@turf/distance";
import {
  point as turfPoint,
  polygon as turfPolygon,
  multiPolygon as turfMultiPolygon,
} from "@turf/helpers";
import {
  fetchSanJoseGeneralPlan,
  fetchSanJoseHistoric,
  fetchSanJoseOverlays,
  fetchSanJoseParcel,
  fetchSanJoseZoning,
} from "@/lib/connectors/california/san-jose/normalizers";
import { SAN_JOSE_CONFIG } from "@/lib/connectors/california/san-jose/config";
import { fetchSantaClaraCountyParcel } from "@/lib/connectors/california/santa-clara-county/normalizers";
import {
  buildAssessorSearchUrl,
  resolvePropertyProfileAccess,
} from "@/lib/connectors/california/santa-clara-county/property-profile";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { buildGoogleMapLinks } from "@/lib/providers/google/imagery";
import { isAttomConfigured } from "@/lib/providers/attom/config";
import { lookupAttomProperty } from "@/lib/providers/attom/provider";
import { acresToSquareFeet } from "@/lib/providers/attom/normalizer";
import { lookupRentCastProperty } from "@/lib/providers/rentcast/provider";
import { claimsFromInputs, detectConflicts } from "@/lib/research/conflict-detector";
import { FIELD_KEYS } from "@/lib/research/constants";
import { normalizeAddress } from "@/lib/research/normalize-address";
import { generateAiReportContent, aiContentToPemPreparation } from "@/lib/providers/ai/provider";
import { runMockPropertyResearch } from "@/lib/research/mock-research-provider";
import { buildProviderFieldComparison } from "@/lib/research/provider-comparison";
import { lookupPropertyHazards } from "@/lib/providers/hazards/lookup";
import {
  CALFIRE_FHSZ_VIEWER_URL,
  CALFIRE_WUI_VIEWER_URL,
  FEMA_VIEWER_URL,
} from "@/lib/providers/hazards/config";
import type { HazardLayerResult } from "@/lib/providers/hazards/types";
import { buildPreferredFacts } from "@/lib/research/select-preferred-fact";
import { normalizeApn } from "@/lib/property/apn";
import type {
  NormalizedResearchResult,
  ReportSource,
  SiteObservation,
  SourceClaim,
} from "@/lib/research/schemas";
import type { ClaimInput, MatchMethod, SourceType } from "@/lib/research/types";

function nowIso() {
  return new Date().toISOString();
}

function claim(
  fieldKey: string,
  sourceName: string,
  sourceType: SourceType,
  value: string | number | boolean | null | undefined,
  options?: {
    sourceUrl?: string | null;
    matchMethod?: MatchMethod;
    confidence?: ClaimInput["confidence"];
    raw?: unknown;
    sourceRecordId?: string | null;
  },
): ClaimInput | null {
  if (value === null || value === undefined || value === "") return null;
  const normalizedValue = String(value);
  return {
    fieldKey,
    fieldLabel: fieldKey,
    sourceName,
    sourceType,
    sourceUrl: options?.sourceUrl ?? null,
    rawValue: normalizedValue,
    normalizedValue,
    matchMethod: options?.matchMethod ?? "address",
    confidence: options?.confidence ?? "medium",
    sourceUpdatedAt: null,
  };
}

function pushClaim(list: ClaimInput[], item: ClaimInput | null) {
  if (item) list.push(item);
}

function encodeMapsQuery(address: string) {
  return encodeURIComponent(address);
}

function mapRentCastMatch(
  method: "address" | "zip" | "city_state" | "coordinate" | "none",
): MatchMethod {
  if (method === "coordinate") return "coordinate";
  return "address";
}

function geometryContainsPoint(
  geometry: Record<string, unknown> | null | undefined,
  latitude: number,
  longitude: number,
): boolean | null {
  if (!geometry || typeof geometry.type !== "string") return null;
  try {
    const pt = turfPoint([longitude, latitude]);
    if (geometry.type === "Polygon") {
      return booleanPointInPolygon(pt, turfPolygon(geometry.coordinates as number[][][]));
    }
    if (geometry.type === "MultiPolygon") {
      return booleanPointInPolygon(pt, turfMultiPolygon(geometry.coordinates as number[][][][]));
    }
  } catch {
    return null;
  }
  return null;
}

function feetBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return distance(turfPoint([lon1, lat1]), turfPoint([lon2, lat2]), { units: "feet" });
}

export async function runLivePropertyResearch(
  inputAddress: string,
  options?: {
    latitude?: number | null;
    longitude?: number | null;
    placeId?: string | null;
  },
): Promise<NormalizedResearchResult> {
  const env = getEnv();
  const normalized = normalizeAddress(inputAddress);
  const retrievedAt = nowIso();
  const claimInputs: ClaimInput[] = [];
  const sources: ReportSource[] = [];
  const diagnosticsProviders: Array<{
    provider: string;
    status: string;
    responseTimeMs?: number | null;
    message?: string | null;
  }> = [];

  const initialLookup = {
    address: normalized.inputAddress,
    standardizedAddress: normalized.standardizedAddress,
    city: normalized.city,
    county: normalized.countyHint,
    state: normalized.state,
    zipCode: normalized.zipCode,
  };

  const attomConfigured = isAttomConfigured(env);

  const [attomSettled, rentCastSettled] = await Promise.allSettled([
    attomConfigured
      ? lookupAttomProperty(initialLookup)
      : Promise.resolve(null as Awaited<ReturnType<typeof lookupAttomProperty>> | null),
    lookupRentCastProperty(initialLookup),
  ]);

  const attom = attomSettled.status === "fulfilled" ? attomSettled.value : null;
  const rentcast = rentCastSettled.status === "fulfilled" ? rentCastSettled.value : null;

  if (!attomConfigured) {
    diagnosticsProviders.push({
      provider: "ATTOM",
      status: "skipped",
      message: "ATTOM_API_KEY is not configured — running RentCast-only.",
    });
    sources.push({
      sourceName: "ATTOM",
      sourceType: "licensed_property_api",
      sourceUrl: null,
      status: "unavailable",
      retrievedAt,
      responseTimeMs: null,
      statusMessage:
        "ATTOM_API_KEY is not configured (optional). RentCast is the primary provider.",
    });
  } else if (attomSettled.status === "rejected") {
    diagnosticsProviders.push({
      provider: "ATTOM",
      status: "error",
      message: attomSettled.reason instanceof Error ? attomSettled.reason.message : "ATTOM failed",
    });
    sources.push({
      sourceName: "ATTOM",
      sourceType: "licensed_property_api",
      sourceUrl: null,
      status: "error",
      retrievedAt,
      responseTimeMs: null,
      statusMessage:
        attomSettled.reason instanceof Error ? attomSettled.reason.message : "ATTOM failed",
    });
  }

  if (attom) {
    for (const pkg of attom.packageResults) {
      sources.push({
        sourceName: `ATTOM ${pkg.packagePath}`,
        sourceType: "licensed_property_api",
        sourceUrl: null,
        status: pkg.unavailable ? "unavailable" : "active",
        retrievedAt,
        responseTimeMs: pkg.responseTimeMs,
        statusMessage: pkg.statusMessage ?? null,
        endpointName: pkg.packagePath,
        httpStatus: pkg.httpStatus ?? null,
      });
      diagnosticsProviders.push({
        provider: `ATTOM:${pkg.packagePath}`,
        status: pkg.unavailable ? "unavailable" : "active",
        responseTimeMs: pkg.responseTimeMs,
        message: pkg.statusMessage ?? null,
      });
    }
  }

  if (rentCastSettled.status === "rejected") {
    diagnosticsProviders.push({
      provider: "RentCast",
      status: "error",
      message:
        rentCastSettled.reason instanceof Error
          ? rentCastSettled.reason.message
          : "RentCast failed",
    });
    sources.push({
      sourceName: "RentCast",
      sourceType: "licensed_property_api",
      sourceUrl: "https://developers.rentcast.io/",
      status: "error",
      retrievedAt,
      responseTimeMs: null,
      statusMessage:
        rentCastSettled.reason instanceof Error
          ? rentCastSettled.reason.message
          : "RentCast failed",
    });
  } else if (rentcast) {
    sources.push({
      sourceName: "RentCast",
      sourceType: "licensed_property_api",
      sourceUrl: "https://developers.rentcast.io/",
      status: rentcast.status,
      retrievedAt,
      responseTimeMs: rentcast.request.responseTimeMs,
      statusMessage: rentcast.statusMessage,
    });
    diagnosticsProviders.push({
      provider: "RentCast",
      status: rentcast.status,
      responseTimeMs: rentcast.request.responseTimeMs,
      message: rentcast.statusMessage,
    });
  }

  const attomProperty = attom?.property ?? null;
  const rentcastProperty = rentcast?.property ?? null;

  const seedLatitude = options?.latitude ?? null;
  const seedLongitude = options?.longitude ?? null;

  // Prefer confirmed Google/selected coordinates for initial GIS, then licensed providers.
  const latitude =
    seedLatitude ?? attomProperty?.identity.latitude ?? rentcastProperty?.latitude ?? null;
  const longitude =
    seedLongitude ?? attomProperty?.identity.longitude ?? rentcastProperty?.longitude ?? null;

  if (!attomProperty && !rentcastProperty && latitude == null) {
    if (env.ALLOW_MOCK_FALLBACK && env.NODE_ENV !== "production") {
      const mock = await runMockPropertyResearch(inputAddress);
      return {
        ...mock,
        summary: `Mock fallback used because live property providers failed. ${mock.summary}`,
        diagnostics: {
          mockFallback: true,
          providerStatuses: diagnosticsProviders,
        },
      };
    }
    throw new AppError(
      "Live property research failed because no provider returned a confident property match.",
      { code: "LIVE_PROVIDERS_FAILED", statusCode: 502, expose: true },
    );
  }
  const apn = attomProperty?.identity.apn ?? null;
  const standardizedAddress =
    attomProperty?.identity.oneLineAddress ??
    rentcastProperty?.formattedAddress ??
    normalized.standardizedAddress;

  const gisInput = {
    address: normalized.inputAddress,
    standardizedAddress,
    apn,
    latitude,
    longitude,
    city: attomProperty?.identity.locality ?? rentcastProperty?.city ?? normalized.city,
    county: attomProperty?.identity.county ?? rentcastProperty?.county ?? normalized.countyHint,
    state: attomProperty?.identity.state ?? rentcastProperty?.state ?? normalized.state,
    zipCode: attomProperty?.identity.zipCode ?? rentcastProperty?.zipCode ?? normalized.zipCode,
  };

  // Parcel first so zoning/overlays can use official parcel centroids when available.
  const [sjParcelSettled, countyParcelSettled] = await Promise.allSettled([
    fetchSanJoseParcel(gisInput),
    fetchSantaClaraCountyParcel(gisInput),
  ]);

  const sjParcel =
    sjParcelSettled.status === "fulfilled"
      ? sjParcelSettled.value
      : {
          parcel: null,
          responseTimeMs: null,
          statusMessage:
            sjParcelSettled.reason instanceof Error
              ? sjParcelSettled.reason.message
              : "San Jose parcel lookup failed",
        };

  const countyParcel =
    countyParcelSettled.status === "fulfilled"
      ? countyParcelSettled.value
      : {
          apn: null,
          lotSquareFootage: null,
          taxRateArea: null,
          situsCity: null,
          situsZip: null,
          geometryGeojson: null,
          centroidLatitude: null,
          centroidLongitude: null,
          sourceName: "Santa Clara County Parcels (ArcGIS)",
          sourceUrl: null,
          responseTimeMs: null,
          statusMessage:
            countyParcelSettled.reason instanceof Error
              ? countyParcelSettled.reason.message
              : "County parcel lookup failed",
        };

  const gisPointInput = {
    ...gisInput,
    latitude:
      sjParcel.parcel?.centroidLatitude ?? countyParcel?.centroidLatitude ?? gisInput.latitude,
    longitude:
      sjParcel.parcel?.centroidLongitude ?? countyParcel?.centroidLongitude ?? gisInput.longitude,
    apn: sjParcel.parcel?.apn ?? countyParcel?.apn ?? gisInput.apn,
  };

  const [sjZoningSettled, sjGpSettled, sjHistoricSettled, sjOverlaysSettled] =
    await Promise.allSettled([
      fetchSanJoseZoning(gisPointInput),
      fetchSanJoseGeneralPlan(gisPointInput),
      fetchSanJoseHistoric(gisPointInput),
      fetchSanJoseOverlays(gisPointInput),
    ]);

  const sjZoning =
    sjZoningSettled.status === "fulfilled"
      ? sjZoningSettled.value
      : {
          zoning: null,
          responseTimeMs: null,
          statusMessage:
            sjZoningSettled.reason instanceof Error
              ? sjZoningSettled.reason.message
              : "Zoning lookup failed",
        };
  const sjGeneralPlan =
    sjGpSettled.status === "fulfilled"
      ? sjGpSettled.value
      : {
          generalPlan: null,
          responseTimeMs: null,
          statusMessage:
            sjGpSettled.reason instanceof Error
              ? sjGpSettled.reason.message
              : "General Plan lookup failed",
        };
  const sjHistoric =
    sjHistoricSettled.status === "fulfilled"
      ? sjHistoricSettled.value
      : {
          historic: null,
          responseTimeMs: null,
          statusMessage:
            sjHistoricSettled.reason instanceof Error
              ? sjHistoricSettled.reason.message
              : "Historic lookup failed",
        };
  const sjOverlays =
    sjOverlaysSettled.status === "fulfilled"
      ? sjOverlaysSettled.value
      : { overlays: [], responseTimeMs: null, statusMessage: "Overlay lookup failed" };

  const connectorKeys: string[] = [];
  if (sjParcel.parcel || sjZoning.zoning) connectorKeys.push("ca-san-jose");
  if (countyParcel?.apn) connectorKeys.push("ca-santa-clara-county");

  sources.push({
    sourceName: "San Jose ArcGIS Parcels",
    sourceType: "city_gis",
    sourceUrl: SAN_JOSE_CONFIG.links.parcelsOpenData,
    status: sjParcel.parcel ? "active" : "unavailable",
    retrievedAt,
    responseTimeMs: sjParcel.responseTimeMs,
    statusMessage: sjParcel.statusMessage,
  });
  sources.push({
    sourceName: "San Jose ArcGIS Zoning",
    sourceType: "city_gis",
    sourceUrl: SAN_JOSE_CONFIG.links.zoningMap,
    status: sjZoning.zoning ? "active" : "unavailable",
    retrievedAt,
    responseTimeMs: sjZoning.responseTimeMs,
    statusMessage: sjZoning.statusMessage,
  });
  sources.push({
    sourceName: "San Jose ArcGIS General Plan 2040",
    sourceType: "city_gis",
    sourceUrl: SAN_JOSE_CONFIG.openDataMapServer,
    status: sjGeneralPlan.generalPlan ? "active" : "unavailable",
    retrievedAt,
    responseTimeMs: sjGeneralPlan.responseTimeMs,
    statusMessage: sjGeneralPlan.statusMessage,
  });
  sources.push({
    sourceName: "Santa Clara County Parcels (ArcGIS)",
    sourceType: "county_gis",
    sourceUrl: countyParcel?.sourceUrl ?? null,
    status: countyParcel?.apn ? "active" : "unavailable",
    retrievedAt,
    responseTimeMs: countyParcel?.responseTimeMs ?? null,
    statusMessage: countyParcel?.statusMessage ?? "County parcel unavailable",
  });

  // ATTOM claims
  if (attomProperty) {
    const src = "ATTOM";
    const url = null;
    const id = attomProperty.identity.attomId;
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.apn, src, "licensed_property_api", attomProperty.identity.apn, {
        sourceUrl: url,
        matchMethod: "address",
        confidence: "high",
        sourceRecordId: id,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.lotSqFt, src, "licensed_property_api", attomProperty.lotSquareFootage, {
        sourceUrl: url,
        confidence: "medium",
        sourceRecordId: id,
      }),
    );
    if (attomProperty.lotAcres != null && attomProperty.lotSquareFootage != null) {
      const converted = acresToSquareFeet(attomProperty.lotAcres);
      if (
        converted != null &&
        Math.abs(converted - attomProperty.lotSquareFootage) / attomProperty.lotSquareFootage > 0.03
      ) {
        pushClaim(
          claimInputs,
          claim(
            FIELD_KEYS.lotSqFt,
            "ATTOM lot-acres conversion",
            "licensed_property_api",
            converted,
            { sourceUrl: url, confidence: "low", matchMethod: "address" },
          ),
        );
      }
    }
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.livingAreaSqFt,
        src,
        "licensed_property_api",
        attomProperty.livingAreaSquareFootage,
        { sourceUrl: url, confidence: "high" },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.bedrooms, src, "licensed_property_api", attomProperty.bedrooms, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.bathrooms, src, "licensed_property_api", attomProperty.bathroomsTotal, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.stories, src, "licensed_property_api", attomProperty.stories, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.yearBuilt, src, "licensed_property_api", attomProperty.yearBuilt, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.propertyType, src, "licensed_property_api", attomProperty.propertyType, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.estimatedValue, src, "licensed_property_api", attomProperty.estimatedValue, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.assessedValue,
        src,
        "licensed_property_api",
        attomProperty.assessedValueTotal,
        { sourceUrl: url },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.lastSaleDate, src, "licensed_property_api", attomProperty.lastSaleDate, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.lastSalePrice, src, "licensed_property_api", attomProperty.lastSaleAmount, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.ownerName, src, "licensed_property_api", attomProperty.ownerNames, {
        sourceUrl: url,
        confidence: "medium",
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.ownerMailingAddress,
        src,
        "licensed_property_api",
        attomProperty.ownerMailingAddress,
        { sourceUrl: url, confidence: "medium" },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.subdivision, src, "licensed_property_api", attomProperty.subdivision, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.tractNumber, src, "licensed_property_api", attomProperty.tract, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.buildingCount, src, "licensed_property_api", attomProperty.buildingCount, {
        sourceUrl: url,
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.foundationType, src, "licensed_property_api", attomProperty.foundationType, {
        sourceUrl: url,
        // Assessor-derived and often incomplete — verify on site during feasibility.
        confidence: "medium",
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.latitude, src, "licensed_property_api", attomProperty.identity.latitude, {
        sourceUrl: url,
        matchMethod: "coordinate",
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.longitude, src, "licensed_property_api", attomProperty.identity.longitude, {
        sourceUrl: url,
        matchMethod: "coordinate",
      }),
    );
  }

  if (rentcastProperty) {
    const src = "RentCast";
    const url = "https://developers.rentcast.io/";
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.lotSqFt, src, "licensed_property_api", rentcastProperty.lotSquareFootage, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
        confidence: "medium",
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.livingAreaSqFt,
        src,
        "licensed_property_api",
        rentcastProperty.livingAreaSquareFootage,
        { sourceUrl: url, matchMethod: mapRentCastMatch(rentcastProperty.matchMethod) },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.bedrooms, src, "licensed_property_api", rentcastProperty.bedrooms, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.bathrooms, src, "licensed_property_api", rentcastProperty.bathrooms, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.stories, src, "licensed_property_api", rentcastProperty.stories, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.yearBuilt, src, "licensed_property_api", rentcastProperty.yearBuilt, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.propertyType, src, "licensed_property_api", rentcastProperty.propertyType, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.assessedValue,
        src,
        "licensed_property_api",
        rentcastProperty.assessedValue,
        { sourceUrl: url, matchMethod: mapRentCastMatch(rentcastProperty.matchMethod) },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.lastSaleDate, src, "licensed_property_api", rentcastProperty.lastSaleDate, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.lastSalePrice,
        src,
        "licensed_property_api",
        rentcastProperty.lastSalePrice,
        { sourceUrl: url, matchMethod: mapRentCastMatch(rentcastProperty.matchMethod) },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.ownerName, src, "licensed_property_api", rentcastProperty.ownerNames, {
        sourceUrl: url,
        confidence: "low",
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.ownerMailingAddress,
        src,
        "licensed_property_api",
        rentcastProperty.ownerMailingAddress,
        {
          sourceUrl: url,
          confidence: "low",
          matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
        },
      ),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.subdivision, src, "licensed_property_api", rentcastProperty.subdivision, {
        sourceUrl: url,
        matchMethod: mapRentCastMatch(rentcastProperty.matchMethod),
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.latitude, src, "licensed_property_api", rentcastProperty.latitude, {
        sourceUrl: url,
        matchMethod: "coordinate",
      }),
    );
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.longitude, src, "licensed_property_api", rentcastProperty.longitude, {
        sourceUrl: url,
        matchMethod: "coordinate",
      }),
    );
  }

  if (sjParcel.parcel?.apn) {
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.apn, "San Jose ArcGIS Parcels", "city_gis", sjParcel.parcel.apn, {
        sourceUrl: SAN_JOSE_CONFIG.links.parcelsOpenData,
        matchMethod: "parcel_geometry",
        confidence: "high",
      }),
    );
  }
  if (countyParcel?.apn) {
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.apn, "Santa Clara County Parcels (ArcGIS)", "county_gis", countyParcel.apn, {
        sourceUrl: countyParcel.sourceUrl,
        matchMethod: "apn",
        confidence: "high",
      }),
    );
  }
  if (countyParcel?.lotSquareFootage) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.lotSqFt,
        "Santa Clara County Parcels (ArcGIS)",
        "county_gis",
        countyParcel.lotSquareFootage,
        { sourceUrl: countyParcel.sourceUrl, matchMethod: "parcel_geometry", confidence: "high" },
      ),
    );
  }
  if (countyParcel?.taxRateArea) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.taxRateArea,
        "Santa Clara County Parcels (ArcGIS)",
        "county_gis",
        countyParcel.taxRateArea,
        { sourceUrl: countyParcel.sourceUrl, matchMethod: "apn", confidence: "high" },
      ),
    );
  }
  if (sjZoning.zoning?.zoning) {
    pushClaim(
      claimInputs,
      claim(FIELD_KEYS.zoning, "San Jose ArcGIS Zoning", "city_gis", sjZoning.zoning.zoning, {
        sourceUrl: sjZoning.zoning.sourceUrl,
        matchMethod: "coordinate",
        confidence: "high",
      }),
    );
  }
  if (sjGeneralPlan.generalPlan?.designation) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.generalPlan,
        "San Jose ArcGIS General Plan 2040",
        "city_gis",
        sjGeneralPlan.generalPlan.designation,
        {
          sourceUrl: sjGeneralPlan.generalPlan.sourceUrl,
          matchMethod: "coordinate",
          confidence: "medium",
        },
      ),
    );
  }
  if (sjHistoric.historic?.status) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.historicStatus,
        "San Jose Historic Resources Inventory",
        "city_gis",
        sjHistoric.historic.designation ?? sjHistoric.historic.status,
        {
          sourceUrl: sjHistoric.historic.sourceUrl,
          matchMethod: "coordinate",
          confidence: "medium",
        },
      ),
    );
  }

  // Official hazard lookups (flood / FHSZ / WUI) — each independent; failures fall back to viewer links.
  const hazards = await lookupPropertyHazards(gisPointInput.longitude, gisPointInput.latitude);

  function pushHazardSource(layer: HazardLayerResult, fallbackType: SourceType) {
    const status =
      layer.status === "ok"
        ? "active"
        : layer.status === "error"
          ? "error"
          : layer.status === "no_coverage"
            ? "unavailable"
            : "manual_review";
    sources.push({
      sourceName: layer.sourceName,
      sourceType: fallbackType,
      sourceUrl: layer.viewerUrl || layer.sourceUrl,
      status,
      retrievedAt,
      responseTimeMs: layer.responseTimeMs,
      statusMessage:
        layer.statusMessage ??
        (layer.status === "manual_review"
          ? "Automated lookup unavailable; use the official viewer link."
          : null),
    });
    diagnosticsProviders.push({
      provider: layer.sourceName,
      status,
      responseTimeMs: layer.responseTimeMs,
      message: layer.statusMessage,
    });
  }

  pushHazardSource(hazards.flood, "federal_government");
  pushHazardSource(hazards.fire, "state_government");
  pushHazardSource(hazards.wui, "state_government");

  if (hazards.flood.displayText) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.floodZone,
        hazards.flood.sourceName,
        "federal_government",
        hazards.flood.displayText,
        {
          sourceUrl: hazards.flood.viewerUrl,
          matchMethod: "coordinate",
          confidence: "high",
        },
      ),
    );
  }
  if (hazards.fire.displayText) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.fireZone,
        hazards.fire.sourceName,
        "state_government",
        hazards.fire.displayText,
        {
          sourceUrl: hazards.fire.viewerUrl,
          matchMethod: "coordinate",
          confidence: "high",
        },
      ),
    );
  }
  if (hazards.wui.displayText) {
    pushClaim(
      claimInputs,
      claim(
        FIELD_KEYS.wuiClassification,
        hazards.wui.sourceName,
        "state_government",
        hazards.wui.displayText,
        {
          sourceUrl: hazards.wui.viewerUrl,
          matchMethod: "coordinate",
          // Screen-level indicator only — never overstate as parcel fact.
          confidence: "medium",
        },
      ),
    );
  }

  const preferredApn =
    countyParcel?.apn ?? sjParcel.parcel?.apn ?? attomProperty?.identity.apn ?? null;
  const governingJurisdiction =
    countyParcel?.situsCity?.replace(
      /\w\S*/g,
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    ) ??
    attomProperty?.identity.locality ??
    rentcastProperty?.city ??
    normalized.city;
  const mailingLocality = normalized.city;

  const propertyProfile = resolvePropertyProfileAccess({
    ...gisInput,
    apn: preferredApn,
  });

  // Coordinate conflicts
  if (
    attomProperty?.identity.latitude != null &&
    attomProperty.identity.longitude != null &&
    rentcastProperty?.latitude != null &&
    rentcastProperty.longitude != null
  ) {
    const feet = feetBetween(
      attomProperty.identity.latitude,
      attomProperty.identity.longitude,
      rentcastProperty.latitude,
      rentcastProperty.longitude,
    );
    if (feet > 50) {
      pushClaim(
        claimInputs,
        claim(
          "coordinate_distance_ft",
          "ATTOM vs RentCast",
          "licensed_property_api",
          Math.round(feet),
          {
            matchMethod: "coordinate",
            confidence: feet > 150 ? "low" : "medium",
          },
        ),
      );
    }
  }

  const parcelGeometrySource = sjParcel.parcel?.geometryGeojson
    ? sjParcel.parcel
    : countyParcel?.geometryGeojson
      ? countyParcel
      : null;

  if (parcelGeometrySource?.geometryGeojson && latitude != null && longitude != null) {
    const inside = geometryContainsPoint(
      parcelGeometrySource.geometryGeojson as Record<string, unknown>,
      latitude,
      longitude,
    );
    if (inside === false) {
      pushClaim(
        claimInputs,
        claim("coordinate_within_parcel", parcelGeometrySource.sourceName, "city_gis", "false", {
          matchMethod: "parcel_geometry",
          confidence: "high",
          sourceUrl: parcelGeometrySource.sourceUrl,
        }),
      );
    }
  }

  if (
    !sjZoning.zoning?.zoning &&
    (governingJurisdiction?.toLowerCase().includes("san jose") ?? false)
  ) {
    // Conflict emitted below; no claim value available.
  }

  const claims = claimsFromInputs(claimInputs, retrievedAt);

  // Extra conflict rules layered onto Prompt 1 detector
  const conflicts = detectConflicts(claims);

  if (
    attomProperty?.identity.apn &&
    countyParcel?.apn &&
    normalizeApn(attomProperty.identity.apn) !== normalizeApn(countyParcel.apn)
  ) {
    conflicts.push({
      fieldKey: FIELD_KEYS.apn,
      fieldLabel: "APN",
      severity: "critical",
      description: `ATTOM APN ${attomProperty.identity.apn} disagrees with county GIS APN ${countyParcel.apn}.`,
      values: [
        { sourceName: "ATTOM", value: attomProperty.identity.apn, sourceUrl: null },
        {
          sourceName: "Santa Clara County Parcels (ArcGIS)",
          value: countyParcel.apn,
          sourceUrl: countyParcel.sourceUrl,
        },
      ],
      recommendedResolution:
        "Prefer the county GIS / assessor APN and verify on the assessor site.",
    });
  }

  const distanceClaim = claims.find((item) => item.fieldKey === "coordinate_distance_ft");
  if (distanceClaim?.normalizedValue) {
    const feet = Number(distanceClaim.normalizedValue);
    if (feet > 150) {
      conflicts.push({
        fieldKey: "coordinate_distance_ft",
        fieldLabel: "Coordinate distance",
        severity: "warning",
        description: `ATTOM and RentCast coordinates differ by approximately ${Math.round(feet)} feet.`,
        values: conflictValuesFromClaims(claims, ["latitude", "longitude"]),
        recommendedResolution: "Prefer official parcel centroid for GIS overlays.",
      });
    } else if (feet > 50) {
      conflicts.push({
        fieldKey: "coordinate_distance_ft",
        fieldLabel: "Coordinate distance",
        severity: "information",
        description: `ATTOM and RentCast coordinates differ by approximately ${Math.round(feet)} feet.`,
        values: conflictValuesFromClaims(claims, ["latitude", "longitude"]),
        recommendedResolution:
          "Difference is moderate; confirm map overlays against the parcel polygon.",
      });
    }
  }

  if (
    mailingLocality &&
    governingJurisdiction &&
    mailingLocality.toLowerCase() !== governingJurisdiction.toLowerCase()
  ) {
    conflicts.push({
      fieldKey: "governing_jurisdiction",
      fieldLabel: "Governing jurisdiction",
      severity: "information",
      description: `Mailing locality (${mailingLocality}) differs from governing jurisdiction (${governingJurisdiction}).`,
      values: [
        { sourceName: "Mailing locality", value: mailingLocality, sourceUrl: null },
        { sourceName: "Governing jurisdiction", value: governingJurisdiction, sourceUrl: null },
      ],
      recommendedResolution: "Use governing jurisdiction for planning and permit research.",
    });
  }

  if (!sjZoning.zoning?.zoning && governingJurisdiction?.toLowerCase().includes("san jose")) {
    conflicts.push({
      fieldKey: FIELD_KEYS.zoning,
      fieldLabel: "Zoning",
      severity: "warning",
      description: "San Jose zoning GIS was expected but did not return a zoning designation.",
      values: [
        {
          sourceName: "San Jose ArcGIS Zoning",
          value: "unavailable",
          sourceUrl: SAN_JOSE_CONFIG.links.zoningMap,
        },
      ],
      recommendedResolution: "Verify zoning on the city zoning map before the PEM.",
    });
  }

  if (
    attomProperty?.ownerNames &&
    rentcastProperty?.ownerNames &&
    attomProperty.ownerNames.trim().toLowerCase() !==
      rentcastProperty.ownerNames.trim().toLowerCase()
  ) {
    conflicts.push({
      fieldKey: FIELD_KEYS.ownerName,
      fieldLabel: "Owner name",
      severity: "information",
      description: "ATTOM and RentCast owner names differ.",
      values: [
        { sourceName: "ATTOM", value: attomProperty.ownerNames, sourceUrl: null },
        { sourceName: "RentCast", value: rentcastProperty.ownerNames, sourceUrl: null },
      ],
      recommendedResolution:
        "Owner differences are informational only; confirm with the homeowner during the PEM.",
    });
  }

  const facts = buildPreferredFacts(claims);
  for (const claimItem of claims) {
    const preferred = facts.find((fact) => fact.fieldKey === claimItem.fieldKey);
    claimItem.isPreferred = Boolean(
      preferred &&
      preferred.preferredSourceName === claimItem.sourceName &&
      preferred.normalizedValueText === claimItem.normalizedValue,
    );
  }
  const factValue = (key: string) => facts.find((fact) => fact.fieldKey === key);

  const siteObservations: SiteObservation[] = [];
  if (parcelGeometrySource?.geometryGeojson) {
    siteObservations.push({
      observationType: "parcel_geometry",
      title: "Official parcel polygon retrieved",
      description:
        "A parcel polygon was retrieved from public GIS and can be used to cross-check coordinates.",
      confidence: "high",
      sourceName: parcelGeometrySource.sourceName,
      sourceUrl: parcelGeometrySource.sourceUrl,
    });
  }
  if (sjOverlays.overlays.length > 0) {
    for (const overlay of sjOverlays.overlays) {
      siteObservations.push({
        observationType: "overlay",
        title: `Overlay: ${overlay.name}`,
        description: overlay.description ?? "Property intersects a published planning overlay.",
        confidence: "medium",
        sourceName: overlay.sourceName,
        sourceUrl: overlay.sourceUrl,
      });
    }
  }
  if (attomProperty?.pool || rentcastProperty?.pool) {
    siteObservations.push({
      observationType: "pool",
      title: "Pool indicator present",
      description: "A licensed property source indicates a pool may exist on the property.",
      confidence: "medium",
      sourceName: attomProperty?.pool ? "ATTOM" : "RentCast",
    });
  }
  if ((attomProperty?.buildingCount ?? 0) > 1) {
    siteObservations.push({
      observationType: "building_count",
      title: "Multiple buildings reported",
      description: `ATTOM reports ${attomProperty?.buildingCount} buildings on the property.`,
      confidence: "medium",
      sourceName: "ATTOM",
    });
  }

  const mapLatitude = parcelGeometrySource?.centroidLatitude ?? latitude;
  const mapLongitude = parcelGeometrySource?.centroidLongitude ?? longitude;
  const googleLinks = buildGoogleMapLinks({
    address: standardizedAddress,
    latitude: mapLatitude,
    longitude: mapLongitude,
  });

  const resultWithoutSummary = {
    identity: {
      inputAddress: normalized.inputAddress,
      standardizedAddress,
      apn: preferredApn,
      attomId: attomProperty?.identity.attomId ?? null,
      rentcastId: rentcastProperty?.id ?? null,
      fips: attomProperty?.identity.fips ?? null,
      latitude: parcelGeometrySource?.centroidLatitude ?? latitude,
      longitude: parcelGeometrySource?.centroidLongitude ?? longitude,
      jurisdiction: governingJurisdiction,
      jurisdictionType: governingJurisdiction?.toLowerCase().includes("san jose")
        ? "incorporated city"
        : null,
      mailingLocality,
      county:
        attomProperty?.identity.county ??
        rentcastProperty?.county ??
        normalized.countyHint ??
        "Santa Clara",
      state: attomProperty?.identity.state ?? rentcastProperty?.state ?? normalized.state ?? "CA",
      zipCode:
        attomProperty?.identity.zipCode ??
        rentcastProperty?.zipCode ??
        countyParcel?.situsZip ??
        normalized.zipCode,
    },
    characteristics: {
      propertyType: factValue(FIELD_KEYS.propertyType)?.normalizedValueText ?? null,
      lotSquareFootage: factValue(FIELD_KEYS.lotSqFt)?.normalizedValueNumber ?? null,
      livingAreaSquareFootage: factValue(FIELD_KEYS.livingAreaSqFt)?.normalizedValueNumber ?? null,
      bedrooms: factValue(FIELD_KEYS.bedrooms)?.normalizedValueNumber ?? null,
      bathrooms: factValue(FIELD_KEYS.bathrooms)?.normalizedValueNumber ?? null,
      stories: factValue(FIELD_KEYS.stories)?.normalizedValueNumber ?? null,
      yearBuilt: factValue(FIELD_KEYS.yearBuilt)?.normalizedValueNumber ?? null,
      buildingCount: factValue(FIELD_KEYS.buildingCount)?.normalizedValueNumber ?? null,
      estimatedValue: factValue(FIELD_KEYS.estimatedValue)?.normalizedValueNumber ?? null,
      assessedValue: factValue(FIELD_KEYS.assessedValue)?.normalizedValueNumber ?? null,
      lastSaleDate: factValue(FIELD_KEYS.lastSaleDate)?.normalizedValueText ?? null,
      lastSalePrice: factValue(FIELD_KEYS.lastSalePrice)?.normalizedValueNumber ?? null,
      ownerName: factValue(FIELD_KEYS.ownerName)?.normalizedValueText ?? null,
      ownerMailingAddress: factValue(FIELD_KEYS.ownerMailingAddress)?.normalizedValueText ?? null,
      subdivision: factValue(FIELD_KEYS.subdivision)?.normalizedValueText ?? null,
      tractNumber: factValue(FIELD_KEYS.tractNumber)?.normalizedValueText ?? null,
      taxRateArea: factValue(FIELD_KEYS.taxRateArea)?.normalizedValueText ?? null,
      foundationType: factValue(FIELD_KEYS.foundationType)?.normalizedValueText ?? null,
    },
    planning: {
      zoning: factValue(FIELD_KEYS.zoning)?.normalizedValueText ?? null,
      generalPlanDesignation: factValue(FIELD_KEYS.generalPlan)?.normalizedValueText ?? null,
      jurisdictionType: governingJurisdiction?.toLowerCase().includes("san jose")
        ? "incorporated San Jose"
        : null,
      relevantOverlays: sjOverlays.overlays.map((overlay) => overlay.name),
      historicDesignation: factValue(FIELD_KEYS.historicStatus)?.normalizedValueText ?? null,
      floodZone: factValue(FIELD_KEYS.floodZone)?.normalizedValueText ?? null,
      fireZone: factValue(FIELD_KEYS.fireZone)?.normalizedValueText ?? null,
      wuiClassification: factValue(FIELD_KEYS.wuiClassification)?.normalizedValueText ?? null,
    },
    maps: {
      parcelMapUrl: parcelGeometrySource?.sourceUrl ?? SAN_JOSE_CONFIG.links.parcelsOpenData,
      countyPropertyProfileReportUrl: propertyProfile.url,
      tractMapUrl: buildAssessorSearchUrl(preferredApn),
      assessorUrl: buildAssessorSearchUrl(preferredApn),
      zoningMapUrl: SAN_JOSE_CONFIG.links.zoningMap,
      permitSearchUrl: SAN_JOSE_CONFIG.links.permitSearch,
      redfinUrl: `https://www.redfin.com/stingray/do/query-location?location=${encodeMapsQuery(standardizedAddress)}`,
      googleMapsUrl: googleLinks.googleMapsUrl,
      streetViewUrl: googleLinks.streetViewUrl,
      satelliteImageAvailable: googleLinks.satelliteImageAvailable,
      streetViewImageAvailable: googleLinks.streetViewImageAvailable,
      femaUrl: hazards.flood.viewerUrl || FEMA_VIEWER_URL,
      fireZoneUrl: hazards.fire.viewerUrl || CALFIRE_FHSZ_VIEWER_URL,
      wuiUrl: hazards.wui.viewerUrl || CALFIRE_WUI_VIEWER_URL,
    },
    permits: [],
    facts,
    claims,
    conflicts,
    sources,
    parcelGeometry: parcelGeometrySource?.geometryGeojson
      ? {
          geometryGeojson: parcelGeometrySource.geometryGeojson as Record<string, unknown>,
          centroidLatitude: parcelGeometrySource.centroidLatitude,
          centroidLongitude: parcelGeometrySource.centroidLongitude,
          calculatedAreaSqFt: parcelGeometrySource.lotSquareFootage,
          sourceName: parcelGeometrySource.sourceName,
          sourceUrl: parcelGeometrySource.sourceUrl,
        }
      : null,
    siteObservations,
    propertyProfile,
    diagnostics: {
      attomId: attomProperty?.identity.attomId ?? null,
      rentcastId: rentcastProperty?.id ?? null,
      attomConfigured,
      connectorKeys,
      providerStatuses: diagnosticsProviders,
      selectedSources: Object.fromEntries(
        facts.map((fact) => [fact.fieldKey, fact.preferredSourceName ?? ""]),
      ),
      providerFieldComparison: buildProviderFieldComparison(claims, facts),
      mockFallback: false,
    },
  };

  const draft = {
    ...resultWithoutSummary,
    pemPreparation: {
      overview: "",
      propertyFindings: ["Pending"],
      propertyQuestions: ["Pending"],
      verifyDuringPem: [],
      verifyDuringFeasibility: [],
      verifyThroughTitleOrSurvey: [],
      verifyWithPlanning: [],
    },
    summary: "",
  } as NormalizedResearchResult;

  const aiGeneration = await generateAiReportContent(draft);
  const pemPreparation = aiContentToPemPreparation(aiGeneration.content);
  const summary = aiGeneration.content.researchSummary;

  return {
    ...resultWithoutSummary,
    pemPreparation,
    summary,
    aiGeneration: {
      provider: aiGeneration.provider,
      model: aiGeneration.model,
      status: aiGeneration.status,
      promptVersion: aiGeneration.promptVersion,
      generatedAt: aiGeneration.generatedAt,
      inputHash: aiGeneration.inputHash,
    },
    diagnostics: {
      ...resultWithoutSummary.diagnostics,
      aiProvider: aiGeneration.provider,
      aiStatus: aiGeneration.status,
    },
  };
}

function conflictValuesFromClaims(claims: SourceClaim[], fieldKeys: string[]) {
  return claims
    .filter((claim) => fieldKeys.includes(claim.fieldKey) && claim.normalizedValue)
    .map((claim) => ({
      sourceName: claim.sourceName,
      value: claim.normalizedValue ?? "",
      sourceUrl: claim.sourceUrl ?? null,
    }));
}
