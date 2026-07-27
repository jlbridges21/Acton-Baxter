import "server-only";

/**
 * In-memory ring of recent safe GHL request diagnostics (no tokens / PII bodies).
 */

export type GhlRequestDiagnostic = {
  id: string;
  at: string;
  resource: string;
  method: string;
  path: string;
  apiVersion: string;
  statusCode: number | null;
  latencyMs: number;
  errorCode: string | null;
  errorSummary: string | null;
  ok: boolean;
};

const MAX_ENTRIES = 40;
const store: GhlRequestDiagnostic[] = [];

export function recordGhlRequestDiagnostic(
  entry: Omit<GhlRequestDiagnostic, "id" | "at"> & { at?: string },
): void {
  const full: GhlRequestDiagnostic = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at ?? new Date().toISOString(),
    resource: entry.resource,
    method: entry.method,
    path: entry.path,
    apiVersion: entry.apiVersion,
    statusCode: entry.statusCode,
    latencyMs: entry.latencyMs,
    errorCode: entry.errorCode,
    errorSummary: entry.errorSummary
      ? entry.errorSummary.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240)
      : null,
    ok: entry.ok,
  };
  store.unshift(full);
  if (store.length > MAX_ENTRIES) store.length = MAX_ENTRIES;
}

export function getRecentGhlRequestDiagnostics(limit = 20): GhlRequestDiagnostic[] {
  return store.slice(0, Math.max(1, Math.min(limit, MAX_ENTRIES)));
}

export function clearGhlRequestDiagnosticsForTests(): void {
  store.length = 0;
}
