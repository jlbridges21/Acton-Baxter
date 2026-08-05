import "server-only";

import {
  HYDRANT_MANUAL_LOOKUP_URL,
  HYDRANT_MAX_SEARCH_RADIUS_FT,
  type HydrantSourceKey,
} from "./config";
import { OFFICIAL_HYDRANT_SOURCES, queryNearestArcgisHydrant } from "./arcgis-source";
import { OverpassError, queryNearestOsmHydrant } from "./osm";
import type { HydrantLookupResult } from "./types";

export type HydrantLookupDeps = {
  queryOfficial?: typeof queryNearestArcgisHydrant;
  queryOsm?: typeof queryNearestOsmHydrant;
  maxRadiusFt?: number;
};

/**
 * Official GIS first (SCFD → Campbell), then OSM community fallback.
 * Each source is independent; failures continue the ladder.
 * Hydrants beyond maxRadiusFt are ignored (honest no-data rather than a distant false nearest).
 */
export async function lookupNearestHydrant(
  longitude: number | null | undefined,
  latitude: number | null | undefined,
  deps: HydrantLookupDeps = {},
): Promise<HydrantLookupResult> {
  const started = Date.now();
  const attempted: HydrantSourceKey[] = [];
  const maxRadiusFt = deps.maxRadiusFt ?? HYDRANT_MAX_SEARCH_RADIUS_FT;
  const queryOfficial = deps.queryOfficial ?? queryNearestArcgisHydrant;
  const queryOsm = deps.queryOsm ?? queryNearestOsmHydrant;

  if (
    longitude == null ||
    latitude == null ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    return {
      status: "no_data",
      hydrant: null,
      attemptedSources: attempted,
      statusMessage: "Coordinates required for hydrant distance lookup.",
      manualLookupUrl: null,
      responseTimeMs: Date.now() - started,
    };
  }

  for (const source of OFFICIAL_HYDRANT_SOURCES) {
    attempted.push(source.key);
    try {
      const hit = await queryOfficial(source, longitude, latitude, maxRadiusFt);
      if (hit) {
        return {
          status: "ok",
          hydrant: hit,
          attemptedSources: attempted,
          responseTimeMs: Date.now() - started,
        };
      }
    } catch {
      // try next official source
    }
  }

  attempted.push("osm");
  try {
    const osmHit = await queryOsm(longitude, latitude, maxRadiusFt);
    if (osmHit) {
      return {
        status: "ok",
        hydrant: osmHit,
        attemptedSources: attempted,
        responseTimeMs: Date.now() - started,
      };
    }
  } catch (error) {
    const overpassNote =
      error instanceof OverpassError
        ? ` OpenStreetMap lookup failed (${error.statusCode ?? "error"}).`
        : " OpenStreetMap lookup failed.";
    return {
      status: "no_data",
      hydrant: null,
      attemptedSources: attempted,
      statusMessage: `No mapped hydrant found within ${maxRadiusFt.toLocaleString("en-US")} ft of this location.${overpassNote}`,
      manualLookupUrl: `${HYDRANT_MANUAL_LOOKUP_URL}${latitude.toFixed(5)}/${longitude.toFixed(5)}`,
      responseTimeMs: Date.now() - started,
    };
  }

  return {
    status: "no_data",
    hydrant: null,
    attemptedSources: attempted,
    statusMessage: `No mapped hydrant found within ${maxRadiusFt.toLocaleString("en-US")} ft of this location.`,
    manualLookupUrl: `${HYDRANT_MANUAL_LOOKUP_URL}${latitude.toFixed(5)}/${longitude.toFixed(5)}`,
    responseTimeMs: Date.now() - started,
  };
}

export { HYDRANT_MAX_SEARCH_RADIUS_FT, HYDRANT_PULL_DISTANCE_CAVEAT } from "./config";
export { feetBetween } from "./distance";
export type { HydrantCandidate, HydrantLookupResult } from "./types";
