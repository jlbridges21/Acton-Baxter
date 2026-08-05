import "server-only";

import { queryPointIntersects } from "@/lib/arcgis/query";
import {
  CALFIRE_WUI_FALLBACK_URL,
  CALFIRE_WUI_URL,
  CALFIRE_WUI_VIEWER_URL,
  WUI_CAVEAT,
  isInCaliforniaBbox,
} from "./config";
import type { HazardLayerResult } from "./types";

function attr(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function withCaveat(classification: string): string {
  return `${classification} (${WUI_CAVEAT})`;
}

async function queryWuiLayer(
  layerUrl: string,
  longitude: number,
  latitude: number,
): Promise<{
  classification: string | null;
  hazDesc: string | null;
  wuiNum: string | null;
  responseTimeMs: number;
}> {
  const result = await queryPointIntersects(layerUrl, longitude, latitude, {
    outFields: "WUI_NUM,WUI_DESC,HAZ_NUM,HAZ_DESC,DEN4",
    returnGeometry: false,
    resultRecordCount: 3,
  });
  const feature = result.data.features[0];
  if (!feature?.attributes) {
    return {
      classification: null,
      hazDesc: null,
      wuiNum: null,
      responseTimeMs: result.responseTimeMs,
    };
  }
  const attributes = feature.attributes as Record<string, unknown>;
  return {
    classification: attr(attributes, "WUI_DESC"),
    hazDesc: attr(attributes, "HAZ_DESC"),
    wuiNum: attr(attributes, "WUI_NUM"),
    responseTimeMs: result.responseTimeMs,
  };
}

export async function lookupCalfireWui(
  longitude: number,
  latitude: number,
): Promise<HazardLayerResult> {
  if (!isInCaliforniaBbox(longitude, latitude)) {
    return {
      status: "no_coverage",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE Wildland-Urban Interface",
      sourceUrl: CALFIRE_WUI_VIEWER_URL,
      viewerUrl: CALFIRE_WUI_VIEWER_URL,
      responseTimeMs: null,
      statusMessage: "Point is outside California WUI coverage.",
      details: { caveat: WUI_CAVEAT },
    };
  }

  try {
    let queryResult: Awaited<ReturnType<typeof queryWuiLayer>>;
    try {
      queryResult = await queryWuiLayer(CALFIRE_WUI_URL, longitude, latitude);
    } catch {
      queryResult = await queryWuiLayer(CALFIRE_WUI_FALLBACK_URL, longitude, latitude);
    }

    if (!queryResult.classification) {
      return {
        status: "ok",
        value: "NotMapped",
        displayText: withCaveat(
          "Not mapped as Interface, Intermix, or Influence Zone in the statewide WUI screen layer",
        ),
        sourceName: "CAL FIRE Wildland-Urban Interface (WUI25)",
        sourceUrl: CALFIRE_WUI_VIEWER_URL,
        viewerUrl: CALFIRE_WUI_VIEWER_URL,
        responseTimeMs: queryResult.responseTimeMs,
        statusMessage: null,
        details: { caveat: WUI_CAVEAT },
      };
    }

    const classification = queryResult.classification;
    const hazPart = queryResult.hazDesc ? `; underlying FHSZ ${queryResult.hazDesc}` : "";

    return {
      status: "ok",
      value: classification,
      displayText: withCaveat(`${classification}${hazPart}`),
      sourceName: "CAL FIRE Wildland-Urban Interface (WUI25)",
      sourceUrl: CALFIRE_WUI_VIEWER_URL,
      viewerUrl: CALFIRE_WUI_VIEWER_URL,
      responseTimeMs: queryResult.responseTimeMs,
      statusMessage: null,
      details: {
        classification,
        hazDesc: queryResult.hazDesc,
        wuiNum: queryResult.wuiNum,
        caveat: WUI_CAVEAT,
      },
    };
  } catch (error) {
    return {
      status: "error",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE Wildland-Urban Interface",
      sourceUrl: CALFIRE_WUI_VIEWER_URL,
      viewerUrl: CALFIRE_WUI_VIEWER_URL,
      responseTimeMs: null,
      statusMessage: error instanceof Error ? error.message : "CAL FIRE WUI lookup failed",
      details: { caveat: WUI_CAVEAT },
    };
  }
}
