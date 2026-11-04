/**
 * City-based pricing regions. A city (name + state) belongs to at most one region.
 * ZIP codes are never used to pick a region; they only help resolve an address to a city.
 */

import type { CityRef, Region } from "./types";

/** Lowercase, trimmed, accents removed, "St." expanded, punctuation and "city of" dropped. */
export function normalizeCityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^city of\s+/, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bmt\.?\s/g, "mount ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeState(state: string): string {
  const s = state.trim().toLowerCase();
  if (s === "california" || s === "ca" || s === "calif") return "CA";
  return state.trim().toUpperCase().slice(0, 2);
}

export function cityKey(city: CityRef): string {
  return `${normalizeCityName(city.name)}|${normalizeState(city.state)}`;
}

/** Title-case display form for a typed city name. */
export function displayCityName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export type CityConflict = { city: CityRef; regionIds: string[] };

/** Cities that appear in more than one region (or twice in one region). */
export function findCityConflicts(regions: Region[]): CityConflict[] {
  const seen = new Map<string, { city: CityRef; regionIds: string[] }>();
  for (const region of regions) {
    for (const city of region.cities) {
      const key = cityKey(city);
      const entry = seen.get(key) ?? { city, regionIds: [] };
      entry.regionIds.push(region.id);
      seen.set(key, entry);
    }
  }
  return [...seen.values()].filter((e) => e.regionIds.length > 1);
}

/** The region that owns a city, if any. */
export function regionForCity(regions: Region[], city: CityRef): Region | null {
  const key = cityKey(city);
  return regions.find((r) => r.cities.some((c) => cityKey(c) === key)) ?? null;
}

/** Which region already has this city (excluding `exceptRegionId`). */
export function cityOwner(
  regions: Region[],
  city: CityRef,
  exceptRegionId?: string,
): Region | null {
  const key = cityKey(city);
  return (
    regions.find((r) => r.id !== exceptRegionId && r.cities.some((c) => cityKey(c) === key)) ?? null
  );
}

export const REGION_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#eab308",
  "#14b8a6",
  "#ec4899",
];
