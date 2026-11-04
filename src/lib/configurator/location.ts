/**
 * Customer location → pricing region.
 *
 * The region is chosen by the property's CITY. The customer's own city entry (from the GHL
 * "We'll need your location" form) is used first. A ZIP code is only used to look up USPS
 * city names when the city is missing or unrecognized — never as the region key itself.
 *
 * A successful match returns a signed token naming the verified city. The quote endpoint
 * only returns prices for a valid token, and re-resolves the city against the live regions
 * on every request, so moving a city between regions takes effect immediately.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import places from "./data/ca-places.json";
import { displayCityName, normalizeCityName, normalizeState, regionForCity } from "./regions";
import type { Region } from "./types";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type PlacesData = { zips: Record<string, string[]>; cities: string[] };
const PLACES = places as PlacesData;

export function citiesForZip(postalCode: string): string[] {
  const zip = postalCode.trim().slice(0, 5);
  return /^\d{5}$/.test(zip) ? (PLACES.zips[zip] ?? []) : [];
}

export function californiaCities(): string[] {
  return PLACES.cities;
}

export type LocationInput = { address: string; city: string; state: string; postalCode: string };

export type LocationResult =
  | { status: "supported"; city: string; state: string; regionId: string; regionName: string }
  | { status: "outside"; city: string; state: string }
  | { status: "needs_city"; choices: string[] };

export function resolveLocation(regions: Region[], input: LocationInput): LocationResult {
  const state = input.state ? normalizeState(input.state) : "CA";
  const typed = input.city.trim();
  const zipCities = state === "CA" ? citiesForZip(input.postalCode) : [];

  if (typed) {
    const region = regionForCity(regions, { name: typed, state });
    if (region)
      return {
        status: "supported",
        city: displayCityName(typed),
        state,
        regionId: region.id,
        regionName: region.name,
      };
    // The typed name may be a neighborhood or misspelling; fall back to the ZIP's USPS cities.
    const zipRegions = zipCities
      .map((name) => ({ name, region: regionForCity(regions, { name, state }) }))
      .filter((x) => x.region);
    const distinct = new Set(zipRegions.map((x) => x.region!.id));
    if (
      distinct.size === 1 &&
      !zipCities.some((n) => normalizeCityName(n) === normalizeCityName(typed))
    ) {
      const hit = zipRegions[0]!;
      return {
        status: "supported",
        city: hit.name,
        state,
        regionId: hit.region!.id,
        regionName: hit.region!.name,
      };
    }
    return { status: "outside", city: displayCityName(typed), state };
  }

  if (zipCities.length === 0) return { status: "needs_city", choices: [] };
  const matches = zipCities.map((name) => ({
    name,
    region: regionForCity(regions, { name, state }),
  }));
  const regionIds = new Set(matches.map((m) => m.region?.id ?? "none"));
  if (regionIds.size === 1) {
    const first = matches[0]!;
    return first.region
      ? {
          status: "supported",
          city: first.name,
          state,
          regionId: first.region.id,
          regionName: first.region.name,
        }
      : { status: "outside", city: first.name, state };
  }
  return { status: "needs_city", choices: zipCities };
}

// ---------------------------------------------------------------------------
// Signed location token
// ---------------------------------------------------------------------------

function secret(): string {
  const configured = process.env.CONFIGURATOR_LOCATION_SECRET;
  if (configured && configured.length >= 16) return configured;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey)
    return createHmac("sha256", serviceKey).update("configurator-location-token").digest("hex");
  return "baxter-configurator-local-development-only";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export type LocationClaims = { city: string; state: string; exp: number };

export function issueLocationToken(city: string, state: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ c: city, s: state, e: now + TOKEN_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyLocationToken(
  token: string | undefined | null,
  now = Date.now(),
): LocationClaims | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      c?: unknown;
      s?: unknown;
      e?: unknown;
    };
    if (typeof data.c !== "string" || typeof data.s !== "string" || typeof data.e !== "number")
      return null;
    if (data.e < now) return null;
    return { city: data.c, state: data.s, exp: data.e };
  } catch {
    return null;
  }
}
