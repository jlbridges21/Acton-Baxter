/**
 * Live-verified hydrant GIS endpoints (Aug 2026).
 *
 * SCFD (City of Santa Clara): public Feature Layer, ~3.5k hydrants, Santa Clara
 * city extent — does NOT cover Los Altos or south San Jose (Esther Dr).
 *
 * Campbell PublicWorks Fire_Hydrants: queryable despite fused map cache; ~1k
 * hydrants. Service description claims "from San Jose Water, fused" but the
 * geographic extent is Campbell-local — NOT citywide San Jose. ORIGIN field
 * is null on all features. Nearest Campbell hydrant to 15035 Esther Dr is
 * ~4,700 ft (outside useful search radius).
 *
 * OSM Overpass: free fallback; Los Altos has coverage; Esther Dr / south SJ
 * often sparse within 2,500 ft.
 */

export const HYDRANT_MAX_SEARCH_RADIUS_FT = 2500;

export const HYDRANT_PULL_DISTANCE_CAVEAT =
  "Actual hydrant pull distance is measured along the path of travel and will be longer — measure on site.";

export const SCFD_HYDRANT_LAYER_URL =
  "https://map.santaclaraca.gov/maps/rest/services/SCFD_Tablet_Command/SCFD_Fire_Hydrants/MapServer/0";

export const CAMPBELL_HYDRANT_LAYER_URL =
  "https://gis.campbellca.gov/arcgis/rest/services/PublicWorks/Fire_Hydrants/MapServer/0";

export const OVERPASS_INTERPRETER_URL = "https://overpass-api.de/api/interpreter";

export const OVERPASS_USER_AGENT =
  "ActonADU-Baxter-PropertyResearch/1.0 (fire-hydrant lookup; https://actonadu.com)";

/** Manual lookup when no mapped hydrant is found nearby. */
export const HYDRANT_MANUAL_LOOKUP_URL = "https://www.openstreetmap.org/#map=18/";

export const HYDRANT_SOURCE_KEYS = ["scfd", "campbell", "osm"] as const;
export type HydrantSourceKey = (typeof HYDRANT_SOURCE_KEYS)[number];
