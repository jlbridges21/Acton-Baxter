import "server-only";

import { buildPointGeometryJson } from "@/lib/arcgis/geometry";
import { queryArcgisLayer } from "@/lib/arcgis/query";
import {
  CAMPBELL_HYDRANT_LAYER_URL,
  HYDRANT_MAX_SEARCH_RADIUS_FT,
  SCFD_HYDRANT_LAYER_URL,
  type HydrantSourceKey,
} from "./config";
import { feetBetween } from "./distance";
import type { HydrantCandidate, HydrantConfidenceLabel } from "./types";

type ArcgisHydrantSource = {
  key: HydrantSourceKey;
  layerUrl: string;
  sourceName: string;
  confidenceLabel: HydrantConfidenceLabel;
  sourceLabel: string;
  sourceUrl: string;
  idFields: string[];
};

export const OFFICIAL_HYDRANT_SOURCES: ArcgisHydrantSource[] = [
  {
    key: "scfd",
    layerUrl: SCFD_HYDRANT_LAYER_URL,
    sourceName: "City of Santa Clara SCFD Fire Hydrants",
    confidenceLabel: "official_city_gis",
    sourceLabel: "official city GIS (Santa Clara SCFD)",
    sourceUrl: SCFD_HYDRANT_LAYER_URL,
    idFields: ["FACILITYID", "HYG_FH_NO", "OBJECTID"],
  },
  {
    key: "campbell",
    layerUrl: CAMPBELL_HYDRANT_LAYER_URL,
    sourceName: "Campbell PublicWorks Fire Hydrants (SJ Water local fuse)",
    confidenceLabel: "official_local_gis",
    sourceLabel:
      "official local GIS (Campbell — San Jose Water fused data; Campbell-area extent, not citywide San Jose)",
    sourceUrl: CAMPBELL_HYDRANT_LAYER_URL,
    idFields: ["HYDRANT_NU", "OBJECTID"],
  },
];

function pickId(attributes: Record<string, unknown> | undefined, fields: string[]): string | null {
  if (!attributes) return null;
  for (const field of fields) {
    const value = attributes[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

/**
 * Query an ArcGIS hydrant point layer for the nearest feature within the search radius.
 * Uses point + distance (feet) spatial query; returns null when none within radius.
 */
export async function queryNearestArcgisHydrant(
  source: ArcgisHydrantSource,
  longitude: number,
  latitude: number,
  maxRadiusFt: number = HYDRANT_MAX_SEARCH_RADIUS_FT,
): Promise<HydrantCandidate | null> {
  const result = await queryArcgisLayer(source.layerUrl, {
    geometry: buildPointGeometryJson(longitude, latitude),
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    distance: maxRadiusFt,
    units: "esriSRUnit_Foot",
    outFields: "*",
    returnGeometry: true,
    resultRecordCount: 50,
  });

  const features = result.data.features ?? [];
  let best: HydrantCandidate | null = null;

  for (const feature of features) {
    const geometry = feature.geometry as { x?: number; y?: number } | null | undefined;
    const x = geometry?.x;
    const y = geometry?.y;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const distanceFt = feetBetween(longitude, latitude, x, y);
    if (distanceFt > maxRadiusFt) continue;
    if (best && distanceFt >= best.distanceFt) continue;

    best = {
      longitude: x,
      latitude: y,
      distanceFt: Math.round(distanceFt),
      sourceKey: source.key,
      sourceName: source.sourceName,
      confidenceLabel: source.confidenceLabel,
      sourceLabel: source.sourceLabel,
      sourceUrl: source.sourceUrl,
      externalId: pickId(
        feature.attributes as Record<string, unknown> | undefined,
        source.idFields,
      ),
    };
  }

  return best;
}
