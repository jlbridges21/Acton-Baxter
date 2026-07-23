import { calculatePolygonCentroid, esriPolygonToGeoJson } from "@/lib/arcgis/geometry";
import { queryAttribute, queryPointIntersects } from "@/lib/arcgis/query";
import type { ArcgisPolygonGeometry } from "@/lib/arcgis/types";
import type {
  NormalizedGeneralPlanResult,
  NormalizedHistoricResult,
  NormalizedOverlayResult,
  NormalizedParcelResult,
  NormalizedZoningResult,
  PropertyLookupInput,
} from "@/lib/research/types";
import { SAN_JOSE_CONFIG } from "./config";

function attr(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function asPolygon(geometry: unknown): ArcgisPolygonGeometry | null {
  if (!geometry || typeof geometry !== "object") return null;
  const rings = (geometry as { rings?: unknown }).rings;
  if (!Array.isArray(rings)) return null;
  return geometry as ArcgisPolygonGeometry;
}

export async function fetchSanJoseParcel(input: PropertyLookupInput): Promise<{
  parcel: NormalizedParcelResult | null;
  responseTimeMs: number;
  statusMessage: string | null;
  httpStatus: number;
}> {
  try {
    let result = input.apn
      ? await queryAttribute(
          SAN_JOSE_CONFIG.layers.parcels.url,
          `APN='${input.apn.replace(/'/g, "''")}'`,
          {
            outFields: "APN,PARCELID,LOTNUM,FEATURECLASS",
            returnGeometry: true,
            resultRecordCount: 1,
          },
        )
      : null;

    if (
      (!result || result.data.features.length === 0) &&
      input.latitude != null &&
      input.longitude != null
    ) {
      result = await queryPointIntersects(
        SAN_JOSE_CONFIG.layers.parcels.url,
        input.longitude,
        input.latitude,
        {
          outFields: "APN,PARCELID,LOTNUM,FEATURECLASS",
          returnGeometry: true,
          resultRecordCount: 1,
        },
      );
    }

    if (!result || result.data.features.length === 0) {
      return {
        parcel: null,
        responseTimeMs: result?.responseTimeMs ?? 0,
        statusMessage: "San Jose parcel layer returned no match.",
        httpStatus: result?.httpStatus ?? 404,
      };
    }

    const feature = result.data.features[0]!;
    const geometry = asPolygon(feature.geometry);
    const geojson = esriPolygonToGeoJson(geometry);
    const centroid = calculatePolygonCentroid(geometry);

    return {
      parcel: {
        apn: attr(feature.attributes, SAN_JOSE_CONFIG.layers.parcels.fields.apn),
        lotSquareFootage: null,
        geometryGeojson: geojson,
        centroidLatitude: centroid?.latitude ?? null,
        centroidLongitude: centroid?.longitude ?? null,
        sourceName: "San Jose ArcGIS Parcels",
        sourceUrl: SAN_JOSE_CONFIG.links.parcelsOpenData,
      },
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
      httpStatus: result.httpStatus,
    };
  } catch (error) {
    return {
      parcel: null,
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "San Jose parcel query failed",
      httpStatus: 500,
    };
  }
}

export async function fetchSanJoseZoning(input: PropertyLookupInput): Promise<{
  zoning: NormalizedZoningResult | null;
  responseTimeMs: number;
  statusMessage: string | null;
}> {
  if (input.latitude == null || input.longitude == null) {
    return {
      zoning: null,
      responseTimeMs: 0,
      statusMessage: "Coordinates required for San Jose zoning query.",
    };
  }

  try {
    // Prefer parcel centroid when available for better spatial accuracy.
    let longitude = input.longitude;
    let latitude = input.latitude;
    const parcel = await fetchSanJoseParcel(input);
    if (parcel.parcel?.centroidLongitude != null && parcel.parcel.centroidLatitude != null) {
      longitude = parcel.parcel.centroidLongitude;
      latitude = parcel.parcel.centroidLatitude;
    }

    const result = await queryPointIntersects(
      SAN_JOSE_CONFIG.layers.zoning.url,
      longitude,
      latitude,
      {
        outFields: "ZONING,ZONINGABBREV",
        returnGeometry: false,
        resultRecordCount: 1,
      },
    );
    const feature = result.data.features[0];
    if (!feature) {
      return {
        zoning: null,
        responseTimeMs: result.responseTimeMs,
        statusMessage: "San Jose zoning layer returned no intersecting feature.",
      };
    }
    const zoning = attr(feature.attributes, "ZONING") ?? attr(feature.attributes, "ZONINGABBREV");
    return {
      zoning: {
        zoning,
        sourceName: "San Jose ArcGIS Zoning",
        sourceUrl: SAN_JOSE_CONFIG.links.zoningMap,
      },
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
    };
  } catch (error) {
    return {
      zoning: null,
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "San Jose zoning query failed",
    };
  }
}

export async function fetchSanJoseGeneralPlan(input: PropertyLookupInput): Promise<{
  generalPlan: NormalizedGeneralPlanResult | null;
  responseTimeMs: number;
  statusMessage: string | null;
}> {
  if (input.latitude == null || input.longitude == null) {
    return {
      generalPlan: null,
      responseTimeMs: 0,
      statusMessage: "Coordinates required for San Jose general plan query.",
    };
  }
  try {
    const parcel = await fetchSanJoseParcel(input);
    const longitude = parcel.parcel?.centroidLongitude ?? input.longitude;
    const latitude = parcel.parcel?.centroidLatitude ?? input.latitude;
    const result = await queryPointIntersects(
      SAN_JOSE_CONFIG.layers.generalPlan.url,
      longitude,
      latitude,
      {
        outFields: "GPDESIGNATION",
        returnGeometry: false,
        resultRecordCount: 1,
      },
    );
    const feature = result.data.features[0];
    if (!feature) {
      return {
        generalPlan: null,
        responseTimeMs: result.responseTimeMs,
        statusMessage: "San Jose general plan layer returned no intersecting feature.",
      };
    }
    return {
      generalPlan: {
        designation: attr(feature.attributes, "GPDESIGNATION"),
        sourceName: "San Jose ArcGIS General Plan 2040",
        sourceUrl: SAN_JOSE_CONFIG.openDataMapServer,
      },
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
    };
  } catch (error) {
    return {
      generalPlan: null,
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "San Jose general plan query failed",
    };
  }
}

export async function fetchSanJoseHistoric(input: PropertyLookupInput): Promise<{
  historic: NormalizedHistoricResult | null;
  responseTimeMs: number;
  statusMessage: string | null;
}> {
  if (input.latitude == null || input.longitude == null) {
    return {
      historic: null,
      responseTimeMs: 0,
      statusMessage: "Coordinates required for historic query.",
    };
  }
  try {
    const result = await queryPointIntersects(
      SAN_JOSE_CONFIG.layers.historicResources.url,
      input.longitude,
      input.latitude,
      { outFields: "*", returnGeometry: false, resultRecordCount: 1 },
    );
    const feature = result.data.features[0];
    if (!feature) {
      return {
        historic: {
          status: "Not listed in Historic Resources Inventory",
          designation: null,
          sourceName: "San Jose Historic Resources Inventory",
          sourceUrl: SAN_JOSE_CONFIG.layers.historicResources.url,
        },
        responseTimeMs: result.responseTimeMs,
        statusMessage: null,
      };
    }
    return {
      historic: {
        status: "Listed",
        designation:
          attr(feature.attributes, "NAME") ??
          attr(feature.attributes, "STATUS") ??
          "Historic resource present",
        sourceName: "San Jose Historic Resources Inventory",
        sourceUrl: SAN_JOSE_CONFIG.layers.historicResources.url,
      },
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
    };
  } catch (error) {
    return {
      historic: null,
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "Historic layer unavailable",
    };
  }
}

export async function fetchSanJoseOverlays(input: PropertyLookupInput): Promise<{
  overlays: NormalizedOverlayResult[];
  responseTimeMs: number;
  statusMessage: string | null;
}> {
  if (input.latitude == null || input.longitude == null) {
    return { overlays: [], responseTimeMs: 0, statusMessage: "Coordinates required." };
  }
  try {
    const result = await queryPointIntersects(
      SAN_JOSE_CONFIG.layers.historicArea.url,
      input.longitude,
      input.latitude,
      { outFields: "*", returnGeometry: false, resultRecordCount: 5 },
    );
    const overlays = result.data.features.map((feature, index) => ({
      name: attr(feature.attributes, "NAME") ?? `Historic Area ${index + 1}`,
      code: attr(feature.attributes, "FACILITYID"),
      description: "San Jose historic area overlay",
      sourceName: "San Jose Historic Area",
      sourceUrl: SAN_JOSE_CONFIG.layers.historicArea.url,
    }));
    return {
      overlays,
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
    };
  } catch (error) {
    return {
      overlays: [],
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "Overlay query failed",
    };
  }
}
