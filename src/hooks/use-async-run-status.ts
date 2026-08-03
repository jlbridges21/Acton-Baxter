"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Default poll cadence for Property Research, Project Setup, and PEM NEAT. */
export const DEFAULT_ASYNC_RUN_POLL_INTERVAL_MS = 2000;

/**
 * Stop auto-polling after this duration and surface a manual-refresh state.
 * Covers long PEM NEAT generations and large Drive folder copies without polling forever.
 */
export const DEFAULT_ASYNC_RUN_MAX_DURATION_MS = 15 * 60 * 1000;

export type UseAsyncRunStatusOptions<T> = {
  /** Status URL to GET. When null/undefined, polling is idle. */
  url: string | null | undefined;
  /** When false, no polling (e.g. PEM NEAT when not generating). Default true. */
  enabled?: boolean;
  intervalMs?: number;
  maxDurationMs?: number;
  /** Return true when the run has reached a terminal status (complete/failed/cancelled). */
  isTerminal: (data: T) => boolean;
  /** Optional side effect after each successful parse (e.g. kick a run, update local stage). */
  onData?: (data: T) => void;
  /** Parse JSON body into T. Defaults to identity cast. */
  parse?: (json: unknown) => T;
};

export type UseAsyncRunStatusResult<T> = {
  data: T | null;
  error: string | null;
  isPolling: boolean;
  isTimedOut: boolean;
  /** One-shot fetch; also resets the max-duration clock and resumes polling if timed out. */
  refresh: () => Promise<void>;
  /** Clear timeout flag and resume polling (e.g. after retry). */
  resumePolling: () => void;
};

function defaultParse<T>(json: unknown): T {
  return json as T;
}

export function useAsyncRunStatus<T>(
  options: UseAsyncRunStatusOptions<T>,
): UseAsyncRunStatusResult<T> {
  const {
    url,
    enabled = true,
    intervalMs = DEFAULT_ASYNC_RUN_POLL_INTERVAL_MS,
    maxDurationMs = DEFAULT_ASYNC_RUN_MAX_DURATION_MS,
    isTerminal,
    onData,
    parse = defaultParse,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);

  const isTerminalRef = useRef(isTerminal);
  const onDataRef = useRef(onData);
  const parseRef = useRef(parse);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    isTerminalRef.current = isTerminal;
    onDataRef.current = onData;
    parseRef.current = parse;
  }, [isTerminal, onData, parse]);

  const refresh = useCallback(async () => {
    if (!url) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setIsTimedOut(false);
    setPollEpoch((n) => n + 1);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const json = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(json.error?.message ?? "Unable to load status");
      }
      if (controller.signal.aborted) return;
      const parsed = parseRef.current(json);
      setData(parsed);
      setError(null);
      onDataRef.current?.(parsed);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Unable to load status");
    }
  }, [url]);

  const resumePolling = useCallback(() => {
    startedAtRef.current = Date.now();
    setIsTimedOut(false);
    setError(null);
    setPollEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !url || isTimedOut) {
      return;
    }

    let cancelled = false;
    let stopInterval: (() => void) | null = null;
    startedAtRef.current = Date.now();

    async function pollOnce() {
      if (cancelled || !url) return;

      if (Date.now() - startedAtRef.current >= maxDurationMs) {
        setIsTimedOut(true);
        stopInterval?.();
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(url, { signal: controller.signal });
        const json = (await response.json()) as {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(json.error?.message ?? "Unable to load status");
        }
        if (cancelled || controller.signal.aborted) return;
        const parsed = parseRef.current(json);
        setData(parsed);
        setError(null);
        onDataRef.current?.(parsed);

        if (isTerminalRef.current(parsed)) {
          stopInterval?.();
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load status");
      }
    }

    void pollOnce();
    const interval = setInterval(() => {
      void pollOnce();
    }, intervalMs);
    stopInterval = () => {
      clearInterval(interval);
    };

    return () => {
      cancelled = true;
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, url, intervalMs, maxDurationMs, isTimedOut, pollEpoch]);

  const isTerminalNow = data !== null && isTerminal(data);
  const isPolling = Boolean(enabled && url && !isTimedOut && !isTerminalNow);

  return {
    data,
    error,
    isPolling,
    isTimedOut,
    refresh,
    resumePolling,
  };
}
