/**
 * Empty-query view (recent items, frequent tools, pinned reports, agents, categories) and
 * per-user usage tracking.
 *
 * Recents store only (provider, record id, count) — never titles. Every recent is re-read and
 * re-authorized through its provider's lookup() before it is shown, so an item the viewer has
 * since lost access to (or that was deleted) silently disappears.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq } from "@/lib/agents/store";
import { ValidationError } from "@/lib/errors";
import type { SearchContext } from "./context";
import { activeProviders, toSearchResult, withTimeout } from "./engine";
import { getSearchProvider } from "./registry";
import type { ProviderHit } from "./provider";
import {
  SEARCH_CATEGORIES,
  type CategoryAvailability,
  type SearchHome,
  type SearchResult,
} from "./types";

export type RecentRow = {
  user_id: string;
  provider: string;
  record_id: string;
  category: string;
  use_count: number;
  last_used_at: string;
};

const LOOKUP_TIMEOUT_MS = 2500;
const MAX_RECENTS_PER_USER = 200;

async function recentRows(ctx: SearchContext, limit = 60): Promise<RecentRow[]> {
  return agentDb()
    .select<RecentRow>("global_search_recents", {
      filters: [eq("user_id", ctx.user.id)],
      order: { col: "last_used_at", ascending: false },
      limit,
    })
    .catch(() => []);
}

/** `${provider}:${recordId}` → use count, for in-tier ranking boosts. */
export async function recentUseCounts(ctx: SearchContext): Promise<Map<string, number>> {
  const rows = await recentRows(ctx, 200);
  return new Map(rows.map((r) => [`${r.provider}:${r.record_id}`, r.use_count]));
}

const toResults = (providerId: string, hits: ProviderHit[]): SearchResult[] => {
  const provider = getSearchProvider(providerId);
  if (!provider) return [];
  return hits
    .map((h) => toSearchResult(provider, h, "", { kind: "live" }, new Map()))
    .filter((r): r is SearchResult => r !== null);
};

/** Re-authorize stored references through each provider; keeps the given order. */
async function rehydrate(
  ctx: SearchContext,
  rows: RecentRow[],
  allowed: Set<string>,
): Promise<SearchResult[]> {
  const byProvider = new Map<string, string[]>();
  for (const r of rows) {
    if (!allowed.has(r.provider)) continue;
    byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r.record_id]);
  }
  const found = new Map<string, SearchResult>();
  await Promise.all(
    [...byProvider].map(async ([providerId, ids]) => {
      const provider = getSearchProvider(providerId);
      if (!provider?.lookup) return;
      const hits = await withTimeout(provider.lookup(ctx, ids), LOOKUP_TIMEOUT_MS).catch(() => []);
      for (const r of toResults(providerId, hits)) found.set(r.id, r);
    }),
  );
  return rows
    .map((r) => found.get(`${r.provider}:${r.record_id}`))
    .filter((r): r is SearchResult => Boolean(r));
}

export async function searchCategories(ctx: SearchContext): Promise<CategoryAvailability[]> {
  const active = await activeProviders(ctx);
  const available = await Promise.all(
    active.map(({ provider }) =>
      withTimeout(provider.availability(), 1500)
        .then((a) => a.available)
        .catch(() => false),
    ),
  );
  const byCategory = new Map<string, string[]>();
  active.forEach(({ provider }, i) => {
    if (!available[i]) return;
    byCategory.set(provider.category, [...(byCategory.get(provider.category) ?? []), provider.id]);
  });
  return SEARCH_CATEGORIES.filter((c) => byCategory.has(c.id)).map((c) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    providers: byCategory.get(c.id)!,
  }));
}

export async function buildSearchHome(ctx: SearchContext): Promise<SearchHome> {
  const [categories, rows, active] = await Promise.all([
    searchCategories(ctx),
    recentRows(ctx),
    activeProviders(ctx),
  ]);
  const allowed = new Set(active.map((a) => a.provider.id));
  const empty = async (id: string) => {
    const provider = getSearchProvider(id);
    if (!provider?.emptyState || !allowed.has(id)) return [];
    const hits = await withTimeout(provider.emptyState(ctx), LOOKUP_TIMEOUT_MS).catch(() => []);
    return toResults(id, hits);
  };
  const toolRows = [...rows]
    .filter((r) => r.provider === "tools" || r.provider === "settings")
    .sort((a, b) => b.use_count - a.use_count)
    .slice(0, 6);
  const [recent, frequent, defaultTools, pinnedReports, agents] = await Promise.all([
    rehydrate(ctx, rows.slice(0, 12), allowed),
    rehydrate(ctx, toolRows, allowed),
    empty("tools"),
    empty("reports"),
    empty("agents"),
  ]);
  const frequentTools = [...frequent];
  for (const t of defaultTools) {
    if (frequentTools.length >= 6) break;
    if (!frequentTools.some((f) => f.id === t.id)) frequentTools.push(t);
  }
  let askBaxter = false;
  try {
    const { getEnv } = await import("@/lib/env");
    askBaxter = getEnv().BAXTER_CHAT_ENABLED;
  } catch {
    askBaxter = false;
  }
  return {
    categories,
    recent: recent.slice(0, 8),
    frequentTools,
    pinnedReports,
    agents,
    askBaxter,
  };
}

const SENSITIVE_CATEGORIES = new Set(["customers", "opportunities", "employees"]);

/**
 * Record that the viewer opened a result. The record must still be visible to them (checked
 * through the provider), so ids for records they can't see are never stored.
 */
export async function recordUse(
  ctx: SearchContext,
  input: { provider: string; recordId: string },
): Promise<{ stored: boolean }> {
  const provider = getSearchProvider(input.provider);
  if (!provider) throw new ValidationError("Unknown search provider.");
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(input.recordId)) throw new ValidationError("Invalid record.");
  const allowed = await activeProviders(ctx, provider.category);
  if (!allowed.some((a) => a.provider.id === provider.id)) return { stored: false };
  if (provider.lookup) {
    const hits = await withTimeout(provider.lookup(ctx, [input.recordId]), LOOKUP_TIMEOUT_MS).catch(
      () => [],
    );
    if (!hits.some((h) => h.recordId === input.recordId)) return { stored: false };
  } else {
    return { stored: false };
  }
  const db = agentDb();
  const filters = [
    eq("user_id", ctx.user.id),
    eq("provider", provider.id),
    eq("record_id", input.recordId),
  ];
  const [existing] = await db.select<RecentRow>("global_search_recents", { filters, limit: 1 });
  await db.upsert(
    "global_search_recents",
    {
      user_id: ctx.user.id,
      provider: provider.id,
      record_id: input.recordId,
      category: provider.category,
      use_count: (existing?.use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    },
    ["user_id", "provider", "record_id"],
  );
  if (!existing) {
    const all = await recentRows(ctx, MAX_RECENTS_PER_USER + 50);
    for (const old of all.slice(MAX_RECENTS_PER_USER)) {
      await db.remove("global_search_recents", [
        eq("user_id", ctx.user.id),
        eq("provider", old.provider),
        eq("record_id", old.record_id),
      ]);
    }
  }
  if (SENSITIVE_CATEGORIES.has(provider.category)) {
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.user.label },
      action: "search.open",
      targetType: provider.id,
      targetId: input.recordId,
      summary: `Opened a ${provider.name} record from Global Search.`,
    });
  }
  return { stored: true };
}
