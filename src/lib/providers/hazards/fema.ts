import "server-only";

import { queryPointIntersects } from "@/lib/arcgis/query";
import { FEMA_NFHL_FLOOD_HAZARD_ZONES_URL, FEMA_VIEWER_URL, femaViewerUrlForPoint } from "./config";
import { describeFemaFloodZone } from "./descriptions";
import type { HazardLayerResult } from "./types";

function attr(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryFemaOnce(longitude: number, latitude: number) {
  return queryPointIntersects(FEMA_NFHL_FLOOD_HAZARD_ZONES_URL, longitude, latitude, {
    outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,STUDY_TYP,SOURCE_CIT,DFIRM_ID",
    returnGeometry: false,
    resultRecordCount: 3,
  });
}

export async function lookupFemaFloodZone(
  longitude: number,
  latitude: number,
): Promise<HazardLayerResult> {
  const viewerUrl = femaViewerUrlForPoint(latitude, longitude);
  let lastError: unknown;

  // FEMA NFHL is intermittently reset under concurrent load; a few extra attempts
  // keep flood data without blocking FHSZ/WUI (those run in parallel separately).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await queryFemaOnce(longitude, latitude);
      const feature = result.data.features[0];
      if (!feature?.attributes) {
        return {
          status: "no_coverage",
          value: null,
          displayText: null,
          sourceName: "FEMA NFHL Flood Hazard Zones",
          sourceUrl: viewerUrl,
          viewerUrl,
          responseTimeMs: result.responseTimeMs,
          statusMessage: "No FEMA flood hazard zone polygon at this location.",
          details: {},
        };
      }

      const attributes = feature.attributes as Record<string, unknown>;
      const fldZone = attr(attributes, "FLD_ZONE");
      const zoneSubtype = attr(attributes, "ZONE_SUBTY");
      const displayText = describeFemaFloodZone(fldZone, zoneSubtype);

      return {
        status: "ok",
        value: fldZone,
        displayText,
        sourceName: "FEMA NFHL Flood Hazard Zones",
        sourceUrl: viewerUrl,
        viewerUrl,
        responseTimeMs: result.responseTimeMs,
        statusMessage: null,
        details: {
          fldZone,
          zoneSubtype,
          sfha: attr(attributes, "SFHA_TF"),
          sourceCitation: attr(attributes, "SOURCE_CIT"),
          studyType: attr(attributes, "STUDY_TYP"),
          dfirmId: attr(attributes, "DFIRM_ID"),
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(300 * 2 ** attempt);
      }
    }
  }

  return {
    status: "error",
    value: null,
    displayText: null,
    sourceName: "FEMA NFHL Flood Hazard Zones",
    sourceUrl: FEMA_VIEWER_URL,
    viewerUrl: FEMA_VIEWER_URL,
    responseTimeMs: null,
    statusMessage: lastError instanceof Error ? lastError.message : "FEMA flood zone lookup failed",
    details: {},
  };
}
