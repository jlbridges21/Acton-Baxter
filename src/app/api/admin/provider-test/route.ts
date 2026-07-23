import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { addressRequestSchema } from "@/lib/research/schemas";
import { getEnv } from "@/lib/env";
import { normalizeAddress } from "@/lib/research/normalize-address";
import { lookupAttomProperty } from "@/lib/providers/attom/provider";
import { lookupRentCastProperty } from "@/lib/providers/rentcast/provider";
import {
  fetchSanJoseParcel,
  fetchSanJoseZoning,
} from "@/lib/connectors/california/san-jose/normalizers";
import { fetchSantaClaraCountyParcel } from "@/lib/connectors/california/santa-clara-county/normalizers";
import { detectConflicts, claimsFromInputs } from "@/lib/research/conflict-detector";
import { FIELD_KEYS } from "@/lib/research/constants";
import type { ClaimInput } from "@/lib/research/types";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    if (process.env.NODE_ENV === "production") {
      throw new ValidationError("Provider test is disabled in production");
    }

    const rate = checkRateLimit(`provider-test:${user.id}`, { limit: 5, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const env = getEnv();
    if (env.ENABLE_MOCK_RESEARCH) {
      throw new ValidationError(
        "Set ENABLE_MOCK_RESEARCH=false and configure ATTOM/RentCast keys before running live provider tests.",
      );
    }

    const body = await request.json();
    const parsed = addressRequestSchema.parse(body);
    const normalized = normalizeAddress(parsed.address);
    const lookup = {
      address: normalized.inputAddress,
      standardizedAddress: normalized.standardizedAddress,
      city: normalized.city,
      county: normalized.countyHint,
      state: normalized.state,
      zipCode: normalized.zipCode,
    };

    const [attomResult, rentcastResult] = await Promise.allSettled([
      lookupAttomProperty(lookup),
      lookupRentCastProperty(lookup),
    ]);

    const attom = attomResult.status === "fulfilled" ? attomResult.value : null;
    const rentcast = rentcastResult.status === "fulfilled" ? rentcastResult.value : null;

    const coords = {
      latitude: attom?.property?.identity.latitude ?? rentcast?.property?.latitude ?? null,
      longitude: attom?.property?.identity.longitude ?? rentcast?.property?.longitude ?? null,
      apn: attom?.property?.identity.apn ?? null,
    };

    const gisInput = { ...lookup, ...coords };
    const [sjParcel, sjZoning, countyParcel] = await Promise.all([
      fetchSanJoseParcel(gisInput),
      fetchSanJoseZoning(gisInput),
      fetchSantaClaraCountyParcel(gisInput),
    ]);

    const claimInputs: ClaimInput[] = [];
    if (attom?.property?.identity.apn) {
      claimInputs.push({
        fieldKey: FIELD_KEYS.apn,
        fieldLabel: "APN",
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        rawValue: attom.property.identity.apn,
        normalizedValue: attom.property.identity.apn,
        matchMethod: "address",
        confidence: "high",
      });
    }
    if (countyParcel?.apn) {
      claimInputs.push({
        fieldKey: FIELD_KEYS.apn,
        fieldLabel: "APN",
        sourceName: "Santa Clara County Parcels (ArcGIS)",
        sourceType: "county_gis",
        rawValue: countyParcel.apn,
        normalizedValue: countyParcel.apn,
        matchMethod: "apn",
        confidence: "high",
      });
    }
    if (attom?.property?.lotSquareFootage != null) {
      claimInputs.push({
        fieldKey: FIELD_KEYS.lotSqFt,
        fieldLabel: "Lot size",
        sourceName: "ATTOM",
        sourceType: "licensed_property_api",
        rawValue: String(attom.property.lotSquareFootage),
        normalizedValue: String(attom.property.lotSquareFootage),
        matchMethod: "address",
        confidence: "medium",
      });
    }
    if (countyParcel?.lotSquareFootage != null) {
      claimInputs.push({
        fieldKey: FIELD_KEYS.lotSqFt,
        fieldLabel: "Lot size",
        sourceName: "Santa Clara County Parcels (ArcGIS)",
        sourceType: "county_gis",
        rawValue: String(countyParcel.lotSquareFootage),
        normalizedValue: String(countyParcel.lotSquareFootage),
        matchMethod: "parcel_geometry",
        confidence: "high",
      });
    }

    const claims = claimsFromInputs(claimInputs, new Date().toISOString());
    const conflicts = detectConflicts(claims);

    return jsonOk({
      address: parsed.address,
      attom: {
        status: attom?.property ? "active" : "unavailable",
        responseTimeMs: attom?.packageResults[0]?.responseTimeMs ?? null,
        message:
          attomResult.status === "rejected"
            ? attomResult.reason instanceof Error
              ? attomResult.reason.message
              : "ATTOM failed"
            : attom?.statusMessage,
        attomId: attom?.property?.identity.attomId ?? null,
      },
      rentcast: {
        status: rentcast?.status ?? "error",
        responseTimeMs: rentcast?.request.responseTimeMs ?? null,
        message:
          rentcastResult.status === "rejected"
            ? rentcastResult.reason instanceof Error
              ? rentcastResult.reason.message
              : "RentCast failed"
            : rentcast?.statusMessage,
        rentcastId: rentcast?.property?.id ?? null,
      },
      sanJose: {
        status: sjParcel.parcel || sjZoning.zoning ? "active" : "unavailable",
        responseTimeMs: sjParcel.responseTimeMs || sjZoning.responseTimeMs || null,
        message: sjParcel.statusMessage ?? sjZoning.statusMessage,
      },
      santaClara: {
        status: countyParcel?.apn ? "active" : "unavailable",
        responseTimeMs: countyParcel?.responseTimeMs ?? null,
        message: countyParcel?.statusMessage ?? null,
      },
      normalized: {
        apn: countyParcel?.apn ?? attom?.property?.identity.apn ?? null,
        standardizedAddress:
          attom?.property?.identity.oneLineAddress ??
          rentcast?.property?.formattedAddress ??
          normalized.standardizedAddress,
        lotSqFt: countyParcel?.lotSquareFootage ?? attom?.property?.lotSquareFootage ?? null,
        livingAreaSqFt:
          attom?.property?.livingAreaSquareFootage ??
          rentcast?.property?.livingAreaSquareFootage ??
          null,
        zoning: sjZoning.zoning?.zoning ?? null,
        latitude: coords.latitude,
        longitude: coords.longitude,
        taxRateArea: countyParcel?.taxRateArea ?? null,
      },
      conflicts: conflicts.map((conflict) => ({
        fieldLabel: conflict.fieldLabel,
        severity: conflict.severity,
        description: conflict.description,
      })),
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/provider-test");
  }
}
