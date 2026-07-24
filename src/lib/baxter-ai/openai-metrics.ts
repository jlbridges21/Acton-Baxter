import "server-only";

export type OpenAiCallMetric = {
  at: string;
  ok: boolean;
  code: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  model: string | null;
  retryCount: number;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usedFallback: boolean;
};

type MetricsState = {
  calls: OpenAiCallMetric[];
  duplicatesPrevented: number;
};

const globalMetrics = globalThis as typeof globalThis & {
  __baxterOpenAiMetrics?: MetricsState;
};

function getState(): MetricsState {
  if (!globalMetrics.__baxterOpenAiMetrics) {
    globalMetrics.__baxterOpenAiMetrics = { calls: [], duplicatesPrevented: 0 };
  }
  return globalMetrics.__baxterOpenAiMetrics;
}

export function resetOpenAiMetricsForTests() {
  globalMetrics.__baxterOpenAiMetrics = { calls: [], duplicatesPrevented: 0 };
}

export function recordOpenAiCall(metric: OpenAiCallMetric) {
  const state = getState();
  state.calls.unshift(metric);
  if (state.calls.length > 200) state.calls.length = 200;
}

export function recordDuplicateRequestPrevented() {
  getState().duplicatesPrevented += 1;
}

export function getOpenAiMetricsSnapshot() {
  const state = getState();
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recentHour = state.calls.filter((c) => new Date(c.at).getTime() >= hourAgo);
  const recentDay = state.calls.filter((c) => new Date(c.at).getTime() >= dayAgo);
  const successes = state.calls.filter((c) => c.ok);
  const failures = state.calls.filter((c) => !c.ok);
  const latencies = successes
    .map((c) => c.latencyMs)
    .filter((v): v is number => typeof v === "number");
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

  return {
    lastSuccessfulRequest: successes[0]?.at ?? null,
    lastFailedRequest: failures[0]?.at ?? null,
    lastSafeErrorCode: failures[0]?.code ?? null,
    lastHttpStatus: failures[0]?.httpStatus ?? null,
    lastProviderRequestId: state.calls[0]?.providerRequestId ?? null,
    averageLatencyMs: avgLatency,
    requestsLastHour: recentHour.length,
    rateLimitErrorsLastHour: recentHour.filter(
      (c) => c.code === "BAXTER_OPENAI_RATE_LIMITED" || c.code === "BAXTER_OPENAI_TOKEN_LIMITED",
    ).length,
    quotaErrorsLast24h: recentDay.filter(
      (c) =>
        c.code === "BAXTER_OPENAI_QUOTA_EXCEEDED" ||
        c.code === "BAXTER_OPENAI_BILLING_REQUIRED" ||
        c.code === "BAXTER_OPENAI_PROJECT_LIMIT_REACHED",
    ).length,
    totalRetries: state.calls.reduce((sum, c) => sum + c.retryCount, 0),
    duplicatesPrevented: state.duplicatesPrevented,
    lastInputTokens: state.calls[0]?.inputTokens ?? null,
    lastOutputTokens: state.calls[0]?.outputTokens ?? null,
    lastModel: state.calls[0]?.model ?? null,
  };
}
