import { arcgisFetchJson } from "./client";
import { ArcgisError } from "./errors";
import { buildPointGeometryJson } from "./geometry";
import { arcgisLayerMetadataSchema, arcgisQueryResponseSchema } from "./schemas";
import type { ArcgisLayerMetadata, ArcgisQueryResponse } from "./schemas";
import type { ArcgisQueryParams, ArcgisRequestResult } from "./types";

export function buildArcgisQueryUrl(layerUrl: string, params: ArcgisQueryParams): string {
  const search = new URLSearchParams();
  search.set("f", "json");
  if (params.where) search.set("where", params.where);
  if (params.geometry) search.set("geometry", params.geometry);
  if (params.geometryType) search.set("geometryType", params.geometryType);
  if (params.inSR !== undefined) search.set("inSR", String(params.inSR));
  if (params.outSR !== undefined) search.set("outSR", String(params.outSR));
  if (params.spatialRel) search.set("spatialRel", params.spatialRel);
  search.set("outFields", params.outFields ?? "*");
  search.set("returnGeometry", params.returnGeometry === false ? "false" : "true");
  if (params.resultRecordCount !== undefined) {
    search.set("resultRecordCount", String(params.resultRecordCount));
  }
  if (params.orderByFields) search.set("orderByFields", params.orderByFields);
  if (params.distance !== undefined) search.set("distance", String(params.distance));
  if (params.units) search.set("units", params.units);
  const base = layerUrl.replace(/\/$/, "");
  return `${base}/query?${search.toString()}`;
}

export async function queryArcgisLayer(
  layerUrl: string,
  params: ArcgisQueryParams,
): Promise<ArcgisRequestResult<ArcgisQueryResponse>> {
  const url = buildArcgisQueryUrl(layerUrl, params);
  const result = await arcgisFetchJson<unknown>(url);
  const parsed = arcgisQueryResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new ArcgisError("Unexpected ArcGIS query response shape", {
      statusCode: result.httpStatus,
      endpoint: result.endpoint,
    });
  }
  if (parsed.data.error) {
    throw new ArcgisError(parsed.data.error.message ?? "ArcGIS query failed", {
      statusCode: parsed.data.error.code ?? result.httpStatus,
      endpoint: result.endpoint,
    });
  }
  return { ...result, data: parsed.data };
}

export async function queryPointIntersects(
  layerUrl: string,
  longitude: number,
  latitude: number,
  options?: {
    outFields?: string;
    returnGeometry?: boolean;
    resultRecordCount?: number;
  },
): Promise<ArcgisRequestResult<ArcgisQueryResponse>> {
  return queryArcgisLayer(layerUrl, {
    geometry: buildPointGeometryJson(longitude, latitude),
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: options?.outFields ?? "*",
    returnGeometry: options?.returnGeometry ?? false,
    resultRecordCount: options?.resultRecordCount ?? 5,
  });
}

export async function queryAttribute(
  layerUrl: string,
  where: string,
  options?: {
    outFields?: string;
    returnGeometry?: boolean;
    resultRecordCount?: number;
  },
): Promise<ArcgisRequestResult<ArcgisQueryResponse>> {
  return queryArcgisLayer(layerUrl, {
    where,
    outFields: options?.outFields ?? "*",
    returnGeometry: options?.returnGeometry ?? true,
    outSR: 4326,
    resultRecordCount: options?.resultRecordCount ?? 5,
  });
}

export async function getLayerMetadata(
  layerUrl: string,
): Promise<ArcgisRequestResult<ArcgisLayerMetadata>> {
  const url = `${layerUrl.replace(/\/$/, "")}?f=json`;
  const result = await arcgisFetchJson<unknown>(url);
  const parsed = arcgisLayerMetadataSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new ArcgisError("Unexpected ArcGIS layer metadata", {
      statusCode: result.httpStatus,
      endpoint: result.endpoint,
    });
  }
  return { ...result, data: parsed.data };
}
