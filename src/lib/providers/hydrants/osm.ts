import "server-only";

import { getEnv } from "@/lib/env";
import {
  HYDRANT_MAX_SEARCH_RADIUS_FT,
  OVERPASS_INTERPRETER_URL,
  OVERPASS_USER_AGENT,
} from "./config";
import { feetBetween, feetToLatitudeDegrees } from "./distance";
import type { HydrantCandidate } from "./types";

export class OverpassError extends Error {
  statusCode: number | null;
  retryable: boolean;

  constructor(message: string, options?: { statusCode?: number | null; retryable?: boolean }) {
    super(message);
    this.name = "OverpassError";
    this.statusCode = options?.statusCode ?? null;
    this.retryable = options?.retryable ?? false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OverpassElement = {
  type?: string;
  lat?: number;
  lon?: number;
  id?: number;
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

/**
 * Query OSM Overpass for fire hydrants near a point.
 * Etiquette: modest timeout, identifying User-Agent, graceful 429/504 handling.
 */
export async function queryNearestOsmHydrant(
  longitude: number,
  latitude: number,
  maxRadiusFt: number = HYDRANT_MAX_SEARCH_RADIUS_FT,
): Promise<HydrantCandidate | null> {
  const radiusMeters = Math.ceil(maxRadiusFt * 0.3048);
  // Cap Overpass around-radius so we don't hammer shared infrastructure.
  const aroundMeters = Math.min(Math.max(radiusMeters, 100), 900);
  const query = `[out:json][timeout:20];node["emergency"="fire_hydrant"](around:${aroundMeters},${latitude},${longitude});out body 40;`;

  const env = getEnv();
  const timeoutMs = Math.min(env.EXTERNAL_API_TIMEOUT_MS, 25_000);
  const maxRetries = Math.min(env.EXTERNAL_API_MAX_RETRIES, 1);

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(OVERPASS_INTERPRETER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "*/*",
          "User-Agent": OVERPASS_USER_AGENT,
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 429 || response.status === 504 || response.status === 406) {
        throw new OverpassError(`Overpass temporarily unavailable (${response.status})`, {
          statusCode: response.status,
          retryable: true,
        });
      }
      if (!response.ok) {
        throw new OverpassError(`Overpass request failed (${response.status})`, {
          statusCode: response.status,
          retryable: response.status >= 500,
        });
      }

      const payload = (await response.json()) as OverpassResponse;
      const elements = payload.elements ?? [];
      let best: HydrantCandidate | null = null;

      for (const element of elements) {
        if (typeof element.lat !== "number" || typeof element.lon !== "number") continue;
        const distanceFt = feetBetween(longitude, latitude, element.lon, element.lat);
        if (distanceFt > maxRadiusFt) continue;
        if (best && distanceFt >= best.distanceFt) continue;
        best = {
          longitude: element.lon,
          latitude: element.lat,
          distanceFt: Math.round(distanceFt),
          sourceKey: "osm",
          sourceName: "OpenStreetMap fire hydrants",
          confidenceLabel: "osm_community",
          sourceLabel: "OpenStreetMap community data — coverage not guaranteed",
          sourceUrl: element.id
            ? `https://www.openstreetmap.org/node/${element.id}`
            : "https://www.openstreetmap.org/",
          externalId: element.id != null ? String(element.id) : null,
        };
      }

      return best;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const retryable =
        error instanceof OverpassError
          ? error.retryable
          : error instanceof Error && /abort|timeout|504|429/i.test(error.message);
      if (!retryable || attempt >= maxRetries) break;
      await sleep(750 * (attempt + 1));
      attempt += 1;
    }
  }

  if (lastError instanceof OverpassError) throw lastError;
  if (lastError instanceof Error) {
    throw new OverpassError(lastError.message, { retryable: false });
  }
  throw new OverpassError("Overpass hydrant lookup failed", { retryable: false });
}

/** Exposed for tests — degrees span for the search envelope equivalent. */
export function osmSearchRadiusDegrees(maxRadiusFt: number = HYDRANT_MAX_SEARCH_RADIUS_FT): number {
  return feetToLatitudeDegrees(maxRadiusFt);
}
