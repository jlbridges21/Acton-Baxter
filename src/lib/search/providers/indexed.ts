/**
 * Shared search path for providers backed by global_search_index: index candidates (ACL
 * filtered at retrieval) → provider.lookup (authoritative re-read + permission re-check) →
 * the engine re-ranks against what the viewer may actually see.
 */

import "server-only";

import type { SearchContext } from "../context";
import { indexCandidates } from "../index-store";
import type { ProviderSearchInput, ProviderSearchOutput, SearchProvider } from "../provider";
import { getProviderState } from "../settings";

const CANDIDATES = 120;

export async function indexedSearch(
  provider: SearchProvider,
  ctx: SearchContext,
  input: ProviderSearchInput,
): Promise<ProviderSearchOutput> {
  if (!provider.lookup) throw new Error(`${provider.id} must implement lookup()`);
  const ids = await indexCandidates(ctx, provider, input.query, CANDIDATES);
  const state = await getProviderState(provider.id);
  const hits = ids.length ? await provider.lookup(ctx, ids) : [];
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
