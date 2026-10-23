/**
 * Global Search engine: authorizes providers on the server, runs them concurrently with a
 * timeout budget each, ranks and validates their hits, and streams results provider by
 * provider. One provider failing (or being slow) never blocks the others.
 *
 * No LLM is involved: ranking is deterministic (src/lib/search/rank.ts).
 */

import "server-only";

import { checkRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors";
import type { SearchContext } from "./context";
import { isIndexStale, needsInitialIndex, reindexProvider } from "./index-store";
import { recordProviderSample, recordSearchSample } from "./metrics";
import { addressKey, formatAddress, looksLikeAddress } from "./normalize";
import type { ProviderHit, SearchProvider } from "./provider";
import { combinedScore, compareRanked, contextBoost, highlightRanges, matchDocument } from "./rank";
import { listSearchProviders } from "./registry";
import { safeText, validateResultUrl } from "./safety";
import {
  effectiveFields,
  getProviderStates,
  isProviderEnabled,
  synonymMap,
  type ProviderStateRow,
} from "./settings";
import {
  MAX_QUERY_LENGTH,
  SOURCE_LABELS,
  type AddressGroup,
  type Freshness,
  type ProviderOutcome,
  type SearchCategoryId,
  type SearchResult,
  type SearchStreamEvent,
} from "./types";

export type ActiveProvider = { provider: SearchProvider; state: ProviderStateRow | null };

const PERMISSION_TIMEOUT_MS = 2000;
/** Per-user request budget for external sources (GoHighLevel, BambooHR) per minute. */
const EXTERNAL_LIMIT = { limit: 40, windowMs: 60_000 };
const EXTERNAL_SOURCES = new Set(["gohighlevel", "bamboohr"]);

class TimeoutError extends Error {}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new TimeoutError(`Timed out after ${ms} ms`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function cleanQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const q = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (q.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(`Search is limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  return q;
}

/** Providers this viewer may use: enabled by admins and permitted by the server-side gate. */
export async function activeProviders(
  ctx: SearchContext,
  category?: SearchCategoryId | null,
): Promise<ActiveProvider[]> {
  const states = await getProviderStates().catch(() => new Map<string, ProviderStateRow>());
  const candidates = listSearchProviders().filter(
    (p) => (!category || p.category === category) && isProviderEnabled(p, states.get(p.id) ?? null),
  );
  const permitted = await Promise.all(
    candidates.map((p) => withTimeout(p.canUse(ctx), PERMISSION_TIMEOUT_MS).catch(() => false)),
  );
  return candidates
    .filter((_, i) => permitted[i])
    .map((p) => ({ provider: p, state: states.get(p.id) ?? null }));
}

function scheduleRefresh(provider: SearchProvider) {
  const run = () =>
    reindexProvider(provider, "stale-on-search").catch((error: unknown) => {
      console.error(
        "[search.refresh.failed]",
        provider.id,
        error instanceof Error ? error.message : error,
      );
    });
  void import("next/server").then(({ after }) => after(run)).catch(() => void run());
}

export function toSearchResult(
  provider: SearchProvider,
  hit: ProviderHit,
  query: string,
  freshness: Freshness,
  synonyms: Map<string, string[]>,
  boost?: { recent?: boolean; uses?: number },
): SearchResult | null {
  const valid = validateResultUrl(hit.url);
  const title = safeText(hit.title, 160);
  if (!valid || !title) return null;
  let match = query
    ? matchDocument(query, hit.match, { synonyms })
    : { tier: "exact" as const, score: 0 };
  if (!match) {
    // The source matched on something we can't see locally (e.g. a CRM API's own search).
    if (!hit.sourceMatched) return null;
    match = { tier: "fuzzy", score: 50 };
  }
  const subtitle = safeText(hit.subtitle, 160);
  const addr = hit.address ? addressKey(hit.address) : null;
  const actions = (hit.actions ?? []).filter((a) => {
    if (a.kind === "open") return validateResultUrl(a.href) !== null;
    if (a.kind === "copy") return a.value.length > 0 && a.value.length <= 200;
    return true;
  });
  const score = combinedScore(
    match,
    contextBoost({
      pinned: hit.boost?.pinned,
      recent: hit.boost?.recent || boost?.recent,
      uses: boost?.uses,
    }),
  );
  return {
    id: `${provider.id}:${hit.recordId}`,
    provider: provider.id,
    category: provider.category,
    title,
    subtitle,
    description: safeText(hit.description, 200),
    breadcrumb: (hit.breadcrumb ?? [])
      .map((b) => safeText(b, 60))
      .filter((b): b is string => Boolean(b)),
    highlight: {
      title: query ? highlightRanges(title, query) : [],
      subtitle: query ? highlightRanges(subtitle, query) : [],
    },
    url: valid.url,
    external: valid.external,
    icon: hit.icon ?? provider.icon,
    avatarUrl: hit.avatarUrl && validateResultUrl(hit.avatarUrl) ? hit.avatarUrl : null,
    sourceSystem: provider.sourceSystem,
    sourceLabel: SOURCE_LABELS[provider.sourceSystem],
    recordId: hit.recordId,
    updatedAt: hit.updatedAt ?? null,
    freshness: hit.freshness ?? freshness,
    preview: (hit.preview ?? [])
      .map((p) => ({ label: safeText(p.label, 40), value: safeText(p.value, 80) }))
      .filter((p): p is { label: string; value: string } => Boolean(p.label && p.value))
      .slice(0, 4),
    auth: hit.auth,
    actions,
    tier: match.tier,
    score,
    addressKey: addr ? [addr.key, addr.city ?? "", addr.zip ?? ""].join("|") : null,
    addressDisplay: hit.address ? formatAddress(hit.address) : null,
  };
}

function friendlyError(provider: SearchProvider, status: "timeout" | "error"): string {
  const source = SOURCE_LABELS[provider.sourceSystem];
  return status === "timeout"
    ? `${source} didn't respond in time. Results from it may be missing.`
    : `Couldn't search ${source} right now. Results from it may be missing.`;
}

export type RunProviderInput = {
  query: string;
  limit: number;
  offset: number;
  synonyms: Map<string, string[]>;
  recents: Map<string, number>;
  signal: AbortSignal;
};

export async function runProvider(
  ctx: SearchContext,
  { provider, state }: ActiveProvider,
  input: RunProviderInput,
): Promise<{ outcome: ProviderOutcome; results: SearchResult[] }> {
  const started = performance.now();
  const base = { provider: provider.id, name: provider.name, category: provider.category };
  const done = (
    status: ProviderOutcome["status"],
    results: SearchResult[],
    extra: Partial<ProviderOutcome> = {},
  ) => {
    const latencyMs = Math.round(performance.now() - started);
    if (status !== "skipped") recordProviderSample(provider.id, latencyMs, status);
    return {
      outcome: {
        ...base,
        status,
        message: null,
        count: results.length,
        hasMore: false,
        latencyMs,
        freshness: { kind: "live" } as Freshness,
        ...extra,
      },
      results,
    };
  };

  if (input.query.length < provider.minQueryLength) {
    return done("skipped", [], {
      message: `Type at least ${provider.minQueryLength} characters to search ${SOURCE_LABELS[provider.sourceSystem]}.`,
    });
  }
  try {
    const availability = await withTimeout(provider.availability(), 1500);
    if (!availability.available) {
      return done("unavailable", [], {
        message: availability.reason ?? `${SOURCE_LABELS[provider.sourceSystem]} is unavailable.`,
      });
    }
    if (EXTERNAL_SOURCES.has(provider.sourceSystem)) {
      const rl = checkRateLimit(`search:${provider.id}:${ctx.user.id}`, EXTERNAL_LIMIT);
      if (!rl.allowed) {
        return done("rate_limited", [], {
          message: `Too many ${SOURCE_LABELS[provider.sourceSystem]} searches in a minute. Try again shortly.`,
        });
      }
    }
    if (provider.indexing === "index") {
      if (await needsInitialIndex(provider)) {
        await withTimeout(reindexProvider(provider, "first-search"), provider.timeoutMs).catch(
          () => undefined,
        );
      } else if (await isIndexStale(provider)) {
        scheduleRefresh(provider);
      }
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });
    const fields = effectiveFields(provider, state);
    let output;
    try {
      output = await withTimeout(
        provider.search(ctx, {
          query: input.query,
          limit: input.limit,
          offset: input.offset,
          fields,
          synonyms: input.synonyms,
          signal: controller.signal,
        }),
        provider.timeoutMs,
        () => controller.abort(),
      );
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
    const freshness: Freshness = output.freshness ?? { kind: "live" };
    const ranked = output.hits
      .map((hit) =>
        toSearchResult(provider, hit, input.query, freshness, input.synonyms, {
          uses: input.recents.get(`${provider.id}:${hit.recordId}`),
          recent: input.recents.has(`${provider.id}:${hit.recordId}`),
        }),
      )
      .filter((r): r is SearchResult => r !== null)
      .sort(compareRanked);
    const deduped = dedupe(ranked);
    const paged = provider.indexing === "live" && EXTERNAL_SOURCES.has(provider.sourceSystem);
    const page = paged
      ? deduped.slice(0, input.limit)
      : deduped.slice(input.offset, input.offset + input.limit);
    return done(page.length ? "ok" : "empty", page, {
      count: paged ? input.offset + page.length : deduped.length,
      hasMore: paged ? Boolean(output.hasMore) : deduped.length > input.offset + input.limit,
      freshness,
    });
  } catch (error) {
    const status = error instanceof TimeoutError ? "timeout" : "error";
    if (status === "error") {
      console.error(
        "[search.provider.failed]",
        provider.id,
        error instanceof Error ? error.message : error,
      );
    }
    return done(status, [], { message: friendlyError(provider, status) });
  }
}

/** The same record twice (e.g. from two candidate paths) collapses; different records never do. */
function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * Group results that share a normalized street address across sources. Records are never
 * merged: each stays its own row; a group only lists them together. Same street but a
 * different city or ZIP is a different group.
 */
export function groupAddresses(results: SearchResult[], query: string): AddressGroup[] {
  const candidates = results.filter(
    (r) => r.addressKey && (r.tier === "address" || looksLikeAddress(query)),
  );
  const groups: Array<AddressGroup & { city: string; zip: string }> = [];
  for (const r of candidates) {
    const [key, city = "", zip = ""] = r.addressKey!.split("|");
    const group = groups.find(
      (g) =>
        g.key.split("|")[0] === key &&
        (!g.city || !city || g.city === city) &&
        (!g.zip || !zip || g.zip === zip),
    );
    if (group) {
      group.resultIds.push(r.id);
      if (!group.sources.includes(r.sourceLabel)) group.sources.push(r.sourceLabel);
      group.city ||= city;
      group.zip ||= zip;
    } else {
      groups.push({
        key: r.addressKey!,
        display: r.addressDisplay ?? r.description ?? r.title,
        resultIds: [r.id],
        sources: [r.sourceLabel],
        city,
        zip,
      });
    }
  }
  return groups
    .filter((g) => g.resultIds.length >= 2)
    .map(({ key, display, resultIds, sources }) => ({ key, display, resultIds, sources }));
}

export type SearchRequest = {
  query: string;
  category?: SearchCategoryId | null;
  limit: number;
  offset: number;
};

/** Stream search events: start → one event per provider as it finishes → done. */
export async function* runSearch(
  ctx: SearchContext,
  req: SearchRequest,
  signal: AbortSignal,
): AsyncGenerator<SearchStreamEvent> {
  const started = performance.now();
  const query = cleanQuery(req.query);
  const providers = await activeProviders(ctx, req.category);
  yield {
    type: "start",
    query,
    providers: providers.map(({ provider }) => ({
      provider: provider.id,
      name: provider.name,
      category: provider.category,
    })),
  };
  const [synonyms, recents] = await Promise.all([
    synonymMap().catch(() => new Map<string, string[]>()),
    import("./home").then((m) => m.recentUseCounts(ctx)).catch(() => new Map<string, number>()),
  ]);
  const input: RunProviderInput = {
    query,
    limit: req.limit,
    offset: req.offset,
    synonyms,
    recents,
    signal,
  };
  const pending = new Map<
    number,
    Promise<{ i: number; value: Awaited<ReturnType<typeof runProvider>> }>
  >();
  providers.forEach((p, i) =>
    pending.set(
      i,
      runProvider(ctx, p, input).then((value) => ({ i, value })),
    ),
  );
  const all: SearchResult[] = [];
  while (pending.size > 0) {
    if (signal.aborted) return;
    const { i, value } = await Promise.race(pending.values());
    pending.delete(i);
    all.push(...value.results);
    yield { type: "provider", outcome: value.outcome, results: value.results };
  }
  const { getEnv } = await import("@/lib/env");
  let askBaxter = false;
  try {
    askBaxter = getEnv().BAXTER_CHAT_ENABLED;
  } catch {
    askBaxter = false;
  }
  const tookMs = Math.round(performance.now() - started);
  recordSearchSample(tookMs);
  yield { type: "done", tookMs, addressGroups: groupAddresses(all, query), askBaxter };
}

/** Collect a whole stream (tests, admin diagnostics). */
export async function searchAll(ctx: SearchContext, req: SearchRequest) {
  const events: SearchStreamEvent[] = [];
  for await (const e of runSearch(ctx, req, new AbortController().signal)) events.push(e);
  const providerEvents = events.filter(
    (e): e is Extract<SearchStreamEvent, { type: "provider" }> => e.type === "provider",
  );
  return {
    events,
    outcomes: providerEvents.map((e) => e.outcome),
    results: providerEvents.flatMap((e) => e.results),
    done:
      events.find((e): e is Extract<SearchStreamEvent, { type: "done" }> => e.type === "done") ??
      null,
  };
}
