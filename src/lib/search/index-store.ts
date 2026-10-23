/**
 * Global Search index (table global_search_index, migration 074).
 *
 * Holds only internal or already-synced Baxter data (JobTread job cache, knowledge titles,
 * inventory, site inspections) — never live CRM or HR records. The index generates
 * candidates; the owning provider then re-reads each candidate from its source of truth and
 * re-checks permission, so a deleted record or a removed permission never surfaces even if
 * the index is stale.
 *
 * Retrieval filters by ACL in the database (role, user, capability tags) before ranking.
 * Supabase: the `global_search_query` function (pg_trgm + full-text). Memory mode (unit
 * tests, E2E): the same ACL rules and the TypeScript ranker.
 */

import "server-only";

import { agentDb, callRpc, eq, usesAgentMemoryStore } from "@/lib/agents/store";
import type { SearchContext } from "./context";
import { normalizeAddress, normalizeIdentifier, normalizeText } from "./normalize";
import type { IndexDoc, SearchProvider } from "./provider";
import { matchDocument, tierIndex } from "./rank";
import { getProviderState, saveProviderState } from "./settings";

export type IndexRow = {
  id?: string;
  provider: string;
  record_id: string;
  category: string;
  title: string;
  subtitle: string | null;
  search_text: string;
  identifiers: string[];
  address_norm: string | null;
  url: string;
  acl_roles: string[] | null;
  acl_users: string[] | null;
  acl_capabilities: string[];
  record_updated_at: string | null;
  indexed_at: string;
};

const LOCK_MS = 5 * 60_000;
const CHUNK = 200;

export function toIndexRow(provider: SearchProvider, doc: IndexDoc, indexedAt: string): IndexRow {
  return {
    provider: provider.id,
    record_id: doc.recordId,
    category: provider.category,
    title: doc.title.slice(0, 300),
    subtitle: doc.subtitle?.slice(0, 300) ?? null,
    search_text: normalizeText(`${doc.title} ${doc.subtitle ?? ""} ${doc.searchText}`).slice(
      0,
      4000,
    ),
    identifiers: (doc.identifiers ?? []).map(normalizeIdentifier).filter(Boolean).slice(0, 20),
    address_norm: doc.address ? normalizeAddress(doc.address) : null,
    url: doc.url,
    acl_roles: doc.aclRoles ?? null,
    acl_users: doc.aclUsers ?? null,
    acl_capabilities: doc.aclCapabilities ?? [],
    record_updated_at: doc.recordUpdatedAt ?? null,
    indexed_at: indexedAt,
  };
}

/**
 * Same rule as the SQL function: every ACL clause must pass. Admins pass the per-user clause
 * (Baxter admins can already open every record those clauses protect, e.g. knowledge drafts).
 */
export function rowVisible(
  row: Pick<IndexRow, "acl_roles" | "acl_users" | "acl_capabilities">,
  role: string,
  userId: string,
  caps: string[],
): boolean {
  if (row.acl_roles && !row.acl_roles.includes(role)) return false;
  if (row.acl_users && !row.acl_users.includes(userId) && !caps.includes("admin")) return false;
  return (row.acl_capabilities ?? []).every((c) => caps.includes(c));
}

/** Candidate record ids for a query, ACL-filtered at retrieval. */
export async function indexCandidates(
  ctx: SearchContext,
  provider: SearchProvider,
  query: string,
  limit: number,
): Promise<string[]> {
  const caps = await ctx.capabilities();
  if (usesAgentMemoryStore()) {
    const rows = await agentDb().select<IndexRow>("global_search_index", {
      filters: [eq("provider", provider.id)],
      limit: 20_000,
    });
    return rows
      .filter((r) => rowVisible(r, ctx.user.role, ctx.user.id, caps))
      .map((r) => ({
        id: r.record_id,
        m: matchDocument(query, {
          title: r.title,
          subtitle: r.subtitle,
          identifiers: r.identifiers,
          addresses: [r.address_norm],
          fields: [r.search_text],
        }),
      }))
      .filter((x): x is { id: string; m: NonNullable<typeof x.m> } => x.m !== null)
      .sort((a, b) => tierIndex(a.m.tier) - tierIndex(b.m.tier) || b.m.score - a.m.score)
      .slice(0, limit)
      .map((x) => x.id);
  }
  const rows = await callRpc<Array<{ record_id: string }>>("global_search_query", {
    p_query: query.slice(0, 120),
    p_norm: normalizeText(query).slice(0, 120),
    p_addr: normalizeAddress(query).slice(0, 120),
    p_ident: normalizeIdentifier(query)
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 60),
    p_providers: [provider.id],
    p_role: ctx.user.role,
    p_user: ctx.user.id,
    p_capabilities: caps,
    p_limit: limit,
  });
  return (rows ?? []).map((r) => r.record_id);
}

/** Full refresh: upsert every current document, then delete rows not seen in this run. */
export async function replaceProviderIndex(
  provider: SearchProvider,
  docs: IndexDoc[],
): Promise<{ upserted: number; removed: number }> {
  const db = agentDb();
  const indexedAt = new Date().toISOString();
  const seen = new Set<string>();
  const rows: IndexRow[] = [];
  for (const doc of docs) {
    if (seen.has(doc.recordId)) continue;
    seen.add(doc.recordId);
    rows.push(toIndexRow(provider, doc, indexedAt));
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.upsert("global_search_index", rows.slice(i, i + CHUNK), ["provider", "record_id"]);
  }
  // Every row this run wrote carries exactly this timestamp; anything else is gone at source.
  const removed = await db.remove("global_search_index", [
    eq("provider", provider.id),
    { col: "indexed_at", op: "neq", value: indexedAt },
  ]);
  return { upserted: rows.length, removed };
}

/** Remove every row of a provider (disabled, disconnected, or permission model changed). */
export async function purgeProviderIndex(provider: SearchProvider, reason: string) {
  const removed = await agentDb().remove("global_search_index", [eq("provider", provider.id)]);
  await saveProviderState(provider.id, {
    last_index_status: "purged",
    last_index_error: reason.slice(0, 300),
    indexed_count: 0,
  });
  return removed;
}

export type ReindexResult = {
  provider: string;
  status: "succeeded" | "failed" | "skipped" | "unavailable";
  upserted: number;
  removed: number;
  durationMs: number;
  message: string | null;
};

/** Reindex one provider with a simple lease so concurrent runs don't overlap. */
export async function reindexProvider(
  provider: SearchProvider,
  trigger: string,
): Promise<ReindexResult> {
  const base = { provider: provider.id, upserted: 0, removed: 0, durationMs: 0 };
  if (provider.indexing !== "index" || !provider.indexer) {
    return { ...base, status: "skipped", message: "This provider isn't indexed." };
  }
  const state = await getProviderState(provider.id);
  if (
    state?.last_index_status === "running" &&
    state.index_started_at &&
    Date.now() - new Date(state.index_started_at).getTime() < LOCK_MS
  ) {
    return { ...base, status: "skipped", message: "A refresh is already running." };
  }
  const availability = await provider.availability().catch(() => ({ available: false }));
  if (!availability.available) {
    // A disconnected source must not stay searchable from stale rows.
    await purgeProviderIndex(provider, "Source unavailable");
    return { ...base, status: "unavailable", message: "The source isn't connected." };
  }
  const started = Date.now();
  await saveProviderState(provider.id, {
    last_index_status: "running",
    index_started_at: new Date(started).toISOString(),
    last_index_trigger: trigger.slice(0, 60),
  });
  try {
    const docs = await provider.indexer.fetchAll();
    const { upserted, removed } = await replaceProviderIndex(provider, docs);
    const durationMs = Date.now() - started;
    await saveProviderState(provider.id, {
      last_index_status: "succeeded",
      last_indexed_at: new Date().toISOString(),
      last_index_error: null,
      indexed_count: upserted,
      last_index_duration_ms: durationMs,
    });
    return { ...base, status: "succeeded", upserted, removed, durationMs, message: null };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message.slice(0, 300) : "Index refresh failed";
    console.error("[search.reindex.failed]", { provider: provider.id, message });
    await saveProviderState(provider.id, {
      last_index_status: "failed",
      last_index_error: message,
      last_index_duration_ms: durationMs,
    });
    return { ...base, status: "failed", durationMs, message: "Index refresh failed." };
  }
}

/** True when the provider has never been indexed (first search builds it inline). */
export async function needsInitialIndex(provider: SearchProvider): Promise<boolean> {
  const state = await getProviderState(provider.id);
  return !state?.last_indexed_at;
}

export async function isIndexStale(provider: SearchProvider): Promise<boolean> {
  const state = await getProviderState(provider.id);
  if (!state?.last_indexed_at || !provider.indexer) return true;
  const age = Date.now() - new Date(state.last_indexed_at).getTime();
  return age > provider.indexer.refreshMinutes * 60_000;
}
