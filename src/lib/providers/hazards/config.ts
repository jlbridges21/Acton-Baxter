/**
 * Public hazard GIS endpoints used by Property Research.
 *
 * Verified live (point-in-polygon) before wiring:
 * - FEMA NFHL Flood Hazard Zones = MapServer layer 28 (FLD_ZONE, ZONE_SUBTY, SFHA_TF, …)
 * - CAL FIRE SRA FHSZ = FHSZSRA_23_3 (effective April 1, 2024)
 * - CAL FIRE LRA FHSZ = FHSALRA25_v1_All (map dated March 24, 2025)
 * - CAL FIRE WUI 2025 = publicly queryable FeatureServer hosting WUI25_1 attributes
 *   (WUI_DESC / WUI_NUM). Official Environment/WUI/MapServer and egis FRAP WUI
 *   Image/FeatureServers are currently 404 or token-gated for anonymous clients.
 */

export const FEMA_NFHL_FLOOD_HAZARD_ZONES_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

export const CALFIRE_FHSZ_SRA_URL =
  "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSZSRA_23_3/FeatureServer/0";

export const CALFIRE_FHSZ_LRA_URL =
  "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0";

/** Primary WUI25_1-schema layer (statewide; labeled CAL FIRE WUI 2025). */
export const CALFIRE_WUI_URL =
  "https://services5.arcgis.com/nPtzMLkb4jZLRdvG/arcgis/rest/services/CAL_FIRE_FHSZ_and_WUI_2024_2025/FeatureServer/2";

/** Fallback statewide WUI25 republish if the primary host fails. */
export const CALFIRE_WUI_FALLBACK_URL =
  "https://services1.arcgis.com/9z9tEfqo0TExR9C8/arcgis/rest/services/Wildland_Urban_Interface_2025/FeatureServer/0";

export const FEMA_VIEWER_URL = "https://msc.fema.gov/portal/search";

export const CALFIRE_FHSZ_VIEWER_URL =
  "https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones";

export const CALFIRE_WUI_VIEWER_URL =
  "https://gis.data.cnra.ca.gov/datasets/CALFIRE-Forestry::wildland-urban-interface";

export const CALFIRE_FHSZ_SRA_EFFECTIVE = "April 1, 2024";
export const CALFIRE_FHSZ_LRA_MAP_DATE = "March 24, 2025";

/** Re-export so hazard formatters stay aligned with report UI caveat copy. */
export { WUI_CAVEAT } from "@/lib/research/constants";

/** Rough California bounding box for coverage vs. true service-gap distinction. */
export const CALIFORNIA_BBOX = {
  minLon: -124.5,
  maxLon: -114.0,
  minLat: 32.4,
  maxLat: 42.1,
} as const;

export function isInCaliforniaBbox(longitude: number, latitude: number): boolean {
  return (
    longitude >= CALIFORNIA_BBOX.minLon &&
    longitude <= CALIFORNIA_BBOX.maxLon &&
    latitude >= CALIFORNIA_BBOX.minLat &&
    latitude <= CALIFORNIA_BBOX.maxLat
  );
}

export function femaViewerUrlForPoint(latitude: number, longitude: number): string {
  return `${FEMA_VIEWER_URL}?AddressQuery=${encodeURIComponent(`${latitude}, ${longitude}`)}`;
}
