/**
 * Admin-controlled Global Search settings: provider enable/disable, searchable fields (from
 * each provider's approved list only), and synonyms. Also holds per-provider index state.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import { normalizeText } from "./normalize";
import type { SearchProvider } from "./provider";

export type ProviderStateRow = {
  provider: string;
  enabled: boolean;
  searchable_fields: string[] | null;
  last_indexed_at: string | null;
  last_index_status: "never" | "running" | "succeeded" | "failed" | "purged" | null;
  last_index_error: string | null;
  indexed_count: number | null;
  last_index_duration_ms: number | null;
  last_index_trigger: string | null;
  index_started_at: string | null;
  updated_by: string | null;
  updated_at?: string;
};

export type SynonymRow = {
  id: string;
  term: string;
  synonyms: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const TTL_MS = 30_000;
let cache: { at: number; states: Map<string, ProviderStateRow>; synonyms: SynonymRow[] } | null =
  null;

export function invalidateSearchSettings() {
  cache = null;
}

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const db = agentDb();
  const [states, synonyms] = await Promise.all([
    db.select<ProviderStateRow>("global_search_providers", { limit: 200 }).catch(() => []),
    db.select<SynonymRow>("global_search_synonyms", { limit: 500 }).catch(() => []),
  ]);
  cache = { at: Date.now(), states: new Map(states.map((s) => [s.provider, s])), synonyms };
  return cache;
}

export async function getProviderStates(): Promise<Map<string, ProviderStateRow>> {
  return (await load()).states;
}

export async function getProviderState(id: string): Promise<ProviderStateRow | null> {
  return (await load()).states.get(id) ?? null;
}

export function isProviderEnabled(provider: SearchProvider, state: ProviderStateRow | null) {
  // Core providers are always on; optional ones default on until an admin turns them off.
  return !provider.optional || state?.enabled !== false;
}

/** Enabled field keys = admin choice ∩ approved (standard) fields; defaults when unset. */
export function effectiveFields(
  provider: SearchProvider,
  state: ProviderStateRow | null,
): Set<string> {
  const approved = provider.searchableFields.filter((f) => f.sensitivity === "standard");
  const chosen = state?.searchable_fields;
  const keys = chosen
    ? approved.filter((f) => chosen.includes(f.key)).map((f) => f.key)
    : approved.filter((f) => f.defaultEnabled).map((f) => f.key);
  return new Set(keys);
}

export async function saveProviderState(
  provider: string,
  patch: Partial<Omit<ProviderStateRow, "provider">>,
): Promise<void> {
  await agentDb().upsert(
    "global_search_providers",
    { provider, ...patch, updated_at: new Date().toISOString() },
    ["provider"],
  );
  invalidateSearchSettings();
}

/** Validate an admin's field selection: unknown or restricted keys are refused, not dropped. */
export function validateFieldSelection(provider: SearchProvider, keys: string[]): string[] {
  const byKey = new Map(provider.searchableFields.map((f) => [f.key, f]));
  const bad = keys.filter((k) => byKey.get(k)?.sensitivity !== "standard");
  if (bad.length) {
    throw new ValidationError(
      `These fields can't be made searchable: ${bad.join(", ")}. Only approved fields are allowed.`,
    );
  }
  return [...new Set(keys)];
}

// ---------------------------------------------------------------------------
// Synonyms
// ---------------------------------------------------------------------------

export async function listSynonyms(): Promise<SynonymRow[]> {
  return [...(await load()).synonyms].sort((a, b) => a.term.localeCompare(b.term));
}

/** term → alternates, both directions (searching either word finds the other). */
export async function synonymMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const row of (await load()).synonyms) {
    const words = [row.term, ...row.synonyms].map((w) => normalizeText(w)).filter(Boolean);
    for (const a of words) for (const b of words) add(a, b);
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

function cleanWord(raw: string): string {
  const w = normalizeText(raw);
  if (!w || w.length > 40) throw new ValidationError("Synonyms are 1–40 letters or numbers.");
  return w;
}

export async function upsertSynonym(input: {
  term: string;
  synonyms: string[];
  actorId: string | null;
}): Promise<SynonymRow> {
  const term = cleanWord(input.term);
  const synonyms = [...new Set(input.synonyms.map(cleanWord))].filter((s) => s !== term);
  if (synonyms.length === 0) throw new ValidationError("Add at least one synonym.");
  if (synonyms.length > 10) throw new ValidationError("Up to 10 synonyms per term.");
  const [row] = await agentDb().upsert<SynonymRow>(
    "global_search_synonyms",
    { term, synonyms, created_by: input.actorId },
    ["term"],
  );
  invalidateSearchSettings();
  return row!;
}

export async function deleteSynonym(term: string): Promise<void> {
  await agentDb().remove("global_search_synonyms", [eq("term", normalizeText(term))]);
  invalidateSearchSettings();
}
