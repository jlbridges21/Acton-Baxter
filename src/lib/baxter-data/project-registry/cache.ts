/**
 * Short-lived in-memory cache for Master Project Log rows.
 * Live sheet is source of truth; KB sync can lag behind Project Setup writes.
 */

import type { ProjectLogRow } from "./types";

const DEFAULT_TTL_MS = 90_000;

type CacheEntry = {
  rows: ProjectLogRow[];
  spreadsheetId: string;
  tabName: string;
  fetchedAt: string;
  expiresAt: number;
};

let cache: CacheEntry | null = null;

export function getCachedProjectLog(input: {
  spreadsheetId: string;
  tabName: string;
  now?: number;
}): CacheEntry | null {
  if (!cache) return null;
  const now = input.now ?? Date.now();
  if (cache.expiresAt <= now) return null;
  if (cache.spreadsheetId !== input.spreadsheetId || cache.tabName !== input.tabName) return null;
  return cache;
}

export function setCachedProjectLog(input: {
  rows: ProjectLogRow[];
  spreadsheetId: string;
  tabName: string;
  ttlMs?: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  cache = {
    rows: input.rows,
    spreadsheetId: input.spreadsheetId,
    tabName: input.tabName,
    fetchedAt: new Date(now).toISOString(),
    expiresAt: now + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
}

export function clearProjectLogCacheForTests(): void {
  cache = null;
}
