import "server-only";

import { lookupCalfireFhsz } from "./calfire-fhsz";
import { lookupCalfireWui } from "./calfire-wui";
import { CALFIRE_FHSZ_VIEWER_URL, CALFIRE_WUI_VIEWER_URL, FEMA_VIEWER_URL } from "./config";
import { lookupFemaFloodZone } from "./fema";
import type { HazardLayerResult, PropertyHazardsLookup } from "./types";

function manualReviewResult(
  sourceName: string,
  viewerUrl: string,
  statusMessage: string,
): HazardLayerResult {
  return {
    status: "manual_review",
    value: null,
    displayText: null,
    sourceName,
    sourceUrl: viewerUrl,
    viewerUrl,
    responseTimeMs: null,
    statusMessage,
    details: {},
  };
}

/**
 * Look up flood, FHSZ, and WUI independently. One service failure never blocks the others.
 */
export async function lookupPropertyHazards(
  longitude: number | null | undefined,
  latitude: number | null | undefined,
): Promise<PropertyHazardsLookup> {
  if (
    longitude == null ||
    latitude == null ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    return {
      flood: manualReviewResult(
        "FEMA NFHL Flood Hazard Zones",
        FEMA_VIEWER_URL,
        "Coordinates required for automated flood-zone lookup.",
      ),
      fire: manualReviewResult(
        "CAL FIRE Fire Hazard Severity Zones",
        CALFIRE_FHSZ_VIEWER_URL,
        "Coordinates required for automated fire-hazard lookup.",
      ),
      wui: manualReviewResult(
        "CAL FIRE Wildland-Urban Interface",
        CALFIRE_WUI_VIEWER_URL,
        "Coordinates required for automated WUI lookup.",
      ),
    };
  }

  const [floodSettled, fireSettled, wuiSettled] = await Promise.allSettled([
    lookupFemaFloodZone(longitude, latitude),
    lookupCalfireFhsz(longitude, latitude),
    lookupCalfireWui(longitude, latitude),
  ]);

  return {
    flood:
      floodSettled.status === "fulfilled"
        ? floodSettled.value
        : manualReviewResult(
            "FEMA NFHL Flood Hazard Zones",
            FEMA_VIEWER_URL,
            floodSettled.reason instanceof Error
              ? floodSettled.reason.message
              : "FEMA flood zone lookup failed",
          ),
    fire:
      fireSettled.status === "fulfilled"
        ? fireSettled.value
        : manualReviewResult(
            "CAL FIRE Fire Hazard Severity Zones",
            CALFIRE_FHSZ_VIEWER_URL,
            fireSettled.reason instanceof Error
              ? fireSettled.reason.message
              : "CAL FIRE FHSZ lookup failed",
          ),
    wui:
      wuiSettled.status === "fulfilled"
        ? wuiSettled.value
        : manualReviewResult(
            "CAL FIRE Wildland-Urban Interface",
            CALFIRE_WUI_VIEWER_URL,
            wuiSettled.reason instanceof Error
              ? wuiSettled.reason.message
              : "CAL FIRE WUI lookup failed",
          ),
  };
}

export { WUI_CAVEAT } from "@/lib/research/constants";
