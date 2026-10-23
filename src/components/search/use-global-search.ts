"use client";

/**
 * Global Search client state: debounced typing (200 ms), one in-flight request at a time
 * (stale requests are aborted), and a sequence guard so an out-of-order response can never
 * overwrite a newer one. Results render progressively as each provider's event arrives.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readSearchStream } from "@/lib/search/client";
import {
  DEFAULT_SECTION_LIMIT,
  MAX_QUERY_LENGTH,
  SEE_ALL_LIMIT,
  type AddressGroup,
  type ProviderOutcome,
  type SearchCategoryId,
  type SearchHome,
  type SearchResult,
} from "@/lib/search/types";

export const SEARCH_DEBOUNCE_MS = 200;

export type SearchPhase = "idle" | "loading" | "done" | "error";

export type GlobalSearchState = {
  phase: SearchPhase;
  /** The query the visible results belong to. */
  resultsFor: string;
  results: SearchResult[];
  outcomes: ProviderOutcome[];
  pending: string[];
  addressGroups: AddressGroup[];
  askBaxter: boolean;
  error: string | null;
  tookMs: number | null;
};

const INITIAL: GlobalSearchState = {
  phase: "idle",
  resultsFor: "",
  results: [],
  outcomes: [],
  pending: [],
  addressGroups: [],
  askBaxter: false,
  error: null,
  tookMs: null,
};

function dedupeById(list: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return list.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** Module-level so the default is referentially stable (callbacks depend on it). */
const defaultFetcher: typeof fetch = (...args) => fetch(...args);

export function useGlobalSearch(fetcher: typeof fetch = defaultFetcher) {
  const [query, setQueryState] = useState("");
  const [category, setCategoryState] = useState<SearchCategoryId | null>(null);
  const [state, setState] = useState<GlobalSearchState>(INITIAL);
  const [home, setHome] = useState<SearchHome | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ query: "", category: null as SearchCategoryId | null });

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    async (q: string, cat: SearchCategoryId | null, offset = 0) => {
      controller.current?.abort();
      const id = ++seq.current;
      const trimmed = q.trim();
      if (!trimmed) {
        setState(INITIAL);
        return;
      }
      const ac = new AbortController();
      controller.current = ac;
      // Previous results stay visible (marked loading) until the first new provider answers.
      setState((s) => ({ ...s, phase: "loading", resultsFor: trimmed, error: null }));
      const params = new URLSearchParams({
        q: trimmed,
        limit: String(cat ? SEE_ALL_LIMIT : DEFAULT_SECTION_LIMIT),
        offset: String(offset),
      });
      if (cat) params.set("category", cat);
      let firstProvider = offset === 0;
      try {
        const res = await fetcher(`/api/search?${params}`, {
          signal: ac.signal,
          headers: { accept: "application/x-ndjson" },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? "Search failed. Try again.");
        }
        await readSearchStream(res, (event) => {
          if (id !== seq.current) return; // stale (out of order)
          if (event.type === "start") {
            setState((s) => ({
              ...s,
              pending: event.providers.map((p) => p.provider),
              addressGroups: offset > 0 ? s.addressGroups : [],
            }));
          } else if (event.type === "provider") {
            const reset = firstProvider;
            firstProvider = false;
            setState((s) => ({
              ...s,
              results: dedupeById([...(reset ? [] : s.results), ...event.results]),
              outcomes: [
                ...(reset ? [] : s.outcomes.filter((o) => o.provider !== event.outcome.provider)),
                event.outcome,
              ],
              pending: s.pending.filter((p) => p !== event.outcome.provider),
            }));
          } else if (event.type === "done") {
            setState((s) => ({
              ...s,
              phase: "done",
              results: firstProvider ? [] : s.results,
              outcomes: firstProvider ? [] : s.outcomes,
              pending: [],
              addressGroups: event.addressGroups,
              askBaxter: event.askBaxter,
              tookMs: event.tookMs,
            }));
          } else if (event.type === "error") {
            setState((s) => ({ ...s, phase: "error", error: event.message, pending: [] }));
          }
        });
      } catch (error) {
        if (ac.signal.aborted || id !== seq.current) return;
        setState((s) => ({
          ...s,
          phase: "error",
          pending: [],
          error: error instanceof Error ? error.message : "Search failed. Try again.",
        }));
      }
    },
    [fetcher],
  );

  /** Typing: update immediately, search after the debounce. */
  const setQuery = useCallback(
    (raw: string) => {
      const q = raw.slice(0, MAX_QUERY_LENGTH);
      setQueryState(q);
      latest.current.query = q;
      if (timer.current) clearTimeout(timer.current);
      if (!q.trim()) {
        controller.current?.abort();
        seq.current++;
        setState(INITIAL);
        return;
      }
      timer.current = setTimeout(() => void run(q, latest.current.category), SEARCH_DEBOUNCE_MS);
    },
    [run],
  );

  const setCategory = useCallback(
    (cat: SearchCategoryId | null) => {
      setCategoryState(cat);
      latest.current.category = cat;
      if (timer.current) clearTimeout(timer.current);
      if (latest.current.query.trim()) void run(latest.current.query, cat);
    },
    [run],
  );

  const loadMore = useCallback(() => {
    const cat = latest.current.category;
    if (!cat) return;
    const current = state.results.filter((r) => r.category === cat).length;
    void run(latest.current.query, cat, current);
  }, [run, state.results]);

  const loadHome = useCallback(async () => {
    try {
      const res = await fetcher("/api/search/home", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("Couldn't load search suggestions.");
      setHome((await res.json()) as SearchHome);
      setHomeError(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Couldn't load search suggestions.");
    }
  }, [fetcher]);

  const reset = useCallback(() => {
    cancel();
    seq.current++;
    setQueryState("");
    setCategoryState(null);
    latest.current = { query: "", category: null };
    setState(INITIAL);
  }, [cancel]);

  return {
    query,
    setQuery,
    category,
    setCategory,
    state,
    setState,
    home,
    homeError,
    loadHome,
    loadMore,
    reset,
  };
}
