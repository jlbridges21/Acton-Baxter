import "server-only";

import { queryPointIntersects } from "@/lib/arcgis/query";
import {
  CALFIRE_FHSZ_LRA_MAP_DATE,
  CALFIRE_FHSZ_LRA_URL,
  CALFIRE_FHSZ_SRA_EFFECTIVE,
  CALFIRE_FHSZ_SRA_URL,
  CALFIRE_FHSZ_VIEWER_URL,
  isInCaliforniaBbox,
} from "./config";
import type { HazardLayerResult } from "./types";

function attr(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

type FhszHit = {
  responsibility: "SRA" | "LRA";
  classification: string;
  fhszCode: string | null;
  effectiveLabel: string;
  responseTimeMs: number;
};

async function queryFhszLayer(
  layerUrl: string,
  longitude: number,
  latitude: number,
  responsibility: "SRA" | "LRA",
): Promise<{ hit: FhszHit | null; responseTimeMs: number }> {
  const result = await queryPointIntersects(layerUrl, longitude, latitude, {
    outFields: "SRA,FHSZ,FHSZ_Description",
    returnGeometry: false,
    resultRecordCount: 3,
  });
  const feature = result.data.features[0];
  if (!feature?.attributes) {
    return { hit: null, responseTimeMs: result.responseTimeMs };
  }
  const attributes = feature.attributes as Record<string, unknown>;
  const classification =
    attr(attributes, "FHSZ_Description") ??
    (attr(attributes, "FHSZ") ? `Code ${attr(attributes, "FHSZ")}` : null);
  if (!classification) {
    return { hit: null, responseTimeMs: result.responseTimeMs };
  }
  const sraField = (attr(attributes, "SRA") ?? responsibility).toUpperCase();
  const resolvedResponsibility: "SRA" | "LRA" = sraField.includes("SRA") ? "SRA" : "LRA";
  const effectiveLabel =
    resolvedResponsibility === "SRA"
      ? `effective ${CALFIRE_FHSZ_SRA_EFFECTIVE}`
      : `recommended map dated ${CALFIRE_FHSZ_LRA_MAP_DATE}`;

  return {
    hit: {
      responsibility: resolvedResponsibility,
      classification,
      fhszCode: attr(attributes, "FHSZ"),
      effectiveLabel,
      responseTimeMs: result.responseTimeMs,
    },
    responseTimeMs: result.responseTimeMs,
  };
}

function formatFhszDisplay(hit: FhszHit): string {
  const classLabel = hit.classification;
  if (/^nonwildland$/i.test(classLabel)) {
    return `Not a wildland Fire Hazard Severity Zone (NonWildland; ${hit.responsibility}, ${hit.effectiveLabel})`;
  }
  return `${classLabel} (${hit.responsibility}, ${hit.effectiveLabel})`;
}

export async function lookupCalfireFhsz(
  longitude: number,
  latitude: number,
): Promise<HazardLayerResult> {
  if (!isInCaliforniaBbox(longitude, latitude)) {
    return {
      status: "no_coverage",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE Fire Hazard Severity Zones",
      sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
      viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
      responseTimeMs: null,
      statusMessage: "Point is outside California FHSZ coverage.",
      details: {},
    };
  }

  try {
    // Query SRA and LRA independently so one failure does not block the other.
    const [sraSettled, lraSettled] = await Promise.allSettled([
      queryFhszLayer(CALFIRE_FHSZ_SRA_URL, longitude, latitude, "SRA"),
      queryFhszLayer(CALFIRE_FHSZ_LRA_URL, longitude, latitude, "LRA"),
    ]);

    const sra =
      sraSettled.status === "fulfilled"
        ? sraSettled.value
        : { hit: null, responseTimeMs: 0, error: sraSettled.reason };
    const lra =
      lraSettled.status === "fulfilled"
        ? lraSettled.value
        : { hit: null, responseTimeMs: 0, error: lraSettled.reason };

    const bothFailed = sraSettled.status === "rejected" && lraSettled.status === "rejected";
    if (bothFailed) {
      const message =
        sraSettled.reason instanceof Error
          ? sraSettled.reason.message
          : "CAL FIRE FHSZ lookup failed";
      return {
        status: "error",
        value: null,
        displayText: null,
        sourceName: "CAL FIRE Fire Hazard Severity Zones",
        sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
        viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
        responseTimeMs: null,
        statusMessage: message,
        details: {},
      };
    }

    // Prefer SRA when present (mutual exclusivity by responsibility area).
    const hit = sra.hit ?? lra.hit;
    const responseTimeMs = Math.max(sra.responseTimeMs ?? 0, lra.responseTimeMs ?? 0);

    if (!hit) {
      return {
        status: "ok",
        value: "NotMapped",
        displayText: `Not in a mapped Fire Hazard Severity Zone (checked SRA ${CALFIRE_FHSZ_SRA_EFFECTIVE} and LRA ${CALFIRE_FHSZ_LRA_MAP_DATE})`,
        sourceName: "CAL FIRE Fire Hazard Severity Zones",
        sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
        viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
        responseTimeMs,
        statusMessage: null,
        details: {
          sraQueried: sraSettled.status === "fulfilled",
          lraQueried: lraSettled.status === "fulfilled",
        },
      };
    }

    return {
      status: "ok",
      value: hit.classification,
      displayText: formatFhszDisplay(hit),
      sourceName: "CAL FIRE Fire Hazard Severity Zones",
      sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
      viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
      responseTimeMs,
      statusMessage: null,
      details: {
        responsibility: hit.responsibility,
        classification: hit.classification,
        fhszCode: hit.fhszCode,
        effectiveLabel: hit.effectiveLabel,
      },
    };
  } catch (error) {
    return {
      status: "error",
      value: null,
      displayText: null,
      sourceName: "CAL FIRE Fire Hazard Severity Zones",
      sourceUrl: CALFIRE_FHSZ_VIEWER_URL,
      viewerUrl: CALFIRE_FHSZ_VIEWER_URL,
      responseTimeMs: null,
      statusMessage: error instanceof Error ? error.message : "CAL FIRE FHSZ lookup failed",
      details: {},
    };
  }
}
