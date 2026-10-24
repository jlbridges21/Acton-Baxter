/**
 * Shared search path for providers backed by global_search_index: index candidates (ACL
 * filtered at retrieval) → provider.lookup (authoritative re-read + permission re-check) →
 * the engine re-ranks against what the viewer may actually see.
 *
 * When the index isn't installed in this database (migration 074 not applied) the same
 * documents are built straight from the source (`indexer.fetchAll`, cached briefly) and
 * ranked in TypeScript under the same ACL rules, so search keeps working without it. Every
 * candidate still goes through `lookup`, so authorization is identical on both paths.
 */

import "server-only";

import type { SearchContext } from "../context";
import {
  indexCandidates,
  indexStatus,
  isMissingSchemaError,
  markIndexMissing,
  rankIndexRows,
  toIndexRow,
  type IndexRow,
} from "../index-store";
import type { ProviderSearchInput, ProviderSearchOutput, SearchProvider } from "../provider";
import { getProviderState } from "../settings";

const CANDIDATES = 120;
/** How long source documents are reused between keystrokes on the direct path. */
const SOURCE_TTL_MS = 60_000;

const sourceCache = new Map<string, { at: number; rows: Promise<IndexRow[]> }>();

export function invalidateSourceDocs(providerId?: string) {
  if (providerId) sourceCache.delete(providerId);
  else sourceCache.clear();
}

async function sourceRows(provider: SearchProvider): Promise<{ rows: IndexRow[]; at: number }> {
  const hit = sourceCache.get(provider.id);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return { rows: await hit.rows, at: hit.at };
  const at = Date.now();
  const indexedAt = new Date(at).toISOString();
  const rows = provider
    .indexer!.fetchAll()
    .then((docs) => docs.map((d) => toIndexRow(provider, d, indexedAt)));
  sourceCache.set(provider.id, { at, rows });
  try {
    return { rows: await rows, at };
  } catch (error) {
    // Never cache a failure: the next keystroke tries the source again.
    sourceCache.delete(provider.id);
    throw error;
  }
}

async function directSearch(
  provider: SearchProvider,
  ctx: SearchContext,
  input: ProviderSearchInput,
): Promise<ProviderSearchOutput> {
  const [{ rows, at }, caps] = await Promise.all([sourceRows(provider), ctx.capabilities()]);
  const ids = rankIndexRows(rows, input.query, ctx.user, caps, CANDIDATES);
  const hits = ids.length ? await provider.lookup!(ctx, ids, input.query) : [];
  return {
    hits,
    hasMore: ids.length >= CANDIDATES,
    freshness: { kind: "cached", syncedAt: new Date(at).toISOString(), label: "Read" },
  };
}

export async function indexedSearch(
  provider: SearchProvider,
  ctx: SearchContext,
  input: ProviderSearchInput,
): Promise<ProviderSearchOutput> {
  if (!provider.lookup) throw new Error(`${provider.id} must implement lookup()`);
  if (!provider.indexer) throw new Error(`${provider.id} must implement indexer`);
  if (!(await indexStatus()).ready) return directSearch(provider, ctx, input);
  let ids: string[];
  try {
    ids = await indexCandidates(ctx, provider, input.query, CANDIDATES);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    markIndexMissing();
    return directSearch(provider, ctx, input);
  }
  const state = await getProviderState(provider.id);
  const hits = ids.length ? await provider.lookup(ctx, ids, input.query) : [];
  return {
    hits,
    hasMore: ids.length >= CANDIDATES,
    freshness: {
      kind: "cached",
      syncedAt: state?.last_indexed_at ?? null,
      label: "Indexed",
    },
  };
}
