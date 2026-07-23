import { calculatePolygonCentroid, esriPolygonToGeoJson } from "@/lib/arcgis/geometry";
import { queryAttribute, queryPointIntersects } from "@/lib/arcgis/query";
import type { ArcgisPolygonGeometry } from "@/lib/arcgis/types";
import type { NormalizedParcelResult, PropertyLookupInput } from "@/lib/research/types";
import { SANTA_CLARA_COUNTY_CONFIG } from "./config";

function attr(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function asPolygon(geometry: unknown): ArcgisPolygonGeometry | null {
  if (!geometry || typeof geometry !== "object") return null;
  if (!Array.isArray((geometry as { rings?: unknown }).rings)) return null;
  return geometry as ArcgisPolygonGeometry;
}

export type CountyParcelDetails = NormalizedParcelResult & {
  taxRateArea: string | null;
  situsCity: string | null;
  situsZip: string | null;
  attributes: Record<string, unknown>;
  responseTimeMs: number;
  statusMessage: string | null;
};

export async function fetchSantaClaraCountyParcel(
  input: PropertyLookupInput,
): Promise<CountyParcelDetails | null> {
  try {
    let result = input.apn
      ? await queryAttribute(
          SANTA_CLARA_COUNTY_CONFIG.parcels.url,
          `apn='${input.apn.replace(/'/g, "''")}'`,
          { outFields: "*", returnGeometry: true, resultRecordCount: 1 },
        )
      : null;

    if (
      (!result || result.data.features.length === 0) &&
      input.latitude != null &&
      input.longitude != null
    ) {
      result = await queryPointIntersects(
        SANTA_CLARA_COUNTY_CONFIG.parcels.url,
        input.longitude,
        input.latitude,
        { outFields: "*", returnGeometry: true, resultRecordCount: 1 },
      );
    }

    if (!result || result.data.features.length === 0) {
      return null;
    }

    const feature = result.data.features[0]!;
    const geometry = asPolygon(feature.geometry);
    const geojson = esriPolygonToGeoJson(geometry);
    const centroid = calculatePolygonCentroid(geometry);
    const shapeArea = Number(feature.attributes.shape_area);
    const lotSquareFootage = Number.isFinite(shapeArea) ? Math.round(shapeArea) : null;

    return {
      apn: attr(feature.attributes, "apn"),
      lotSquareFootage,
      geometryGeojson: geojson,
      centroidLatitude: centroid?.latitude ?? null,
      centroidLongitude: centroid?.longitude ?? null,
      sourceName: "Santa Clara County Parcels (ArcGIS)",
      sourceUrl: SANTA_CLARA_COUNTY_CONFIG.parcels.url,
      taxRateArea: attr(feature.attributes, "tax_rate_a"),
      situsCity: attr(feature.attributes, "situs_city"),
      situsZip: attr(feature.attributes, "situs_zip_"),
      attributes: feature.attributes,
      responseTimeMs: result.responseTimeMs,
      statusMessage: null,
    };
  } catch (error) {
    return {
      apn: input.apn ?? null,
      lotSquareFootage: null,
      geometryGeojson: null,
      centroidLatitude: null,
      centroidLongitude: null,
      sourceName: "Santa Clara County Parcels (ArcGIS)",
      sourceUrl: SANTA_CLARA_COUNTY_CONFIG.parcels.url,
      taxRateArea: null,
      situsCity: null,
      situsZip: null,
      attributes: {},
      responseTimeMs: 0,
      statusMessage: error instanceof Error ? error.message : "County parcel query failed",
    };
  }
}
