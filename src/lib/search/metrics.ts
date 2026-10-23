/**
 * Measured Global Search latency, per provider, for the admin diagnostics panel.
 * In-process ring buffer: figures cover this server instance since it started (serverless
 * instances each keep their own). Nothing here is estimated.
 */

import "server-only";

import type { ProviderStatus } from "./types";

type Sample = { at: number; ms: number; status: ProviderStatus };

const MAX = 500;
const samples = new Map<string, Sample[]>();
const totals: Sample[] = [];

export function recordProviderSample(provider: string, ms: number, status: ProviderStatus) {
  const list = samples.get(provider) ?? [];
  list.push({ at: Date.now(), ms, status });
  if (list.length > MAX) list.shift();
  samples.set(provider, list);
}

export function recordSearchSample(ms: number) {
  totals.push({ at: Date.now(), ms, status: "ok" });
  if (totals.length > MAX) totals.shift();
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]!);
}

export type LatencySummary = {
  samples: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  timeouts: number;
  errors: number;
  since: string | null;
};

function summarize(list: Sample[]): LatencySummary {
  const ms = list.map((s) => s.ms);
  return {
    samples: list.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    max: ms.length ? Math.round(Math.max(...ms)) : null,
    timeouts: list.filter((s) => s.status === "timeout").length,
    errors: list.filter((s) => s.status === "error").length,
    since: list[0] ? new Date(list[0].at).toISOString() : null,
  };
}

export function latencySummary(): {
  overall: LatencySummary;
  providers: Record<string, LatencySummary>;
} {
  return {
    overall: summarize(totals),
    providers: Object.fromEntries([...samples].map(([k, v]) => [k, summarize(v)])),
  };
}

export function resetSearchMetricsForTests() {
  samples.clear();
  totals.length = 0;
}
