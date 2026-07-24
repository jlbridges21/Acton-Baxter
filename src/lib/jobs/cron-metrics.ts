import "server-only";

type CronMetric = {
  at: string;
  ok: boolean;
  code: string | null;
};

type State = {
  invocations: CronMetric[];
};

const globalStore = globalThis as typeof globalThis & {
  __baxterCronMetrics?: State;
};

function getState(): State {
  if (!globalStore.__baxterCronMetrics) {
    globalStore.__baxterCronMetrics = { invocations: [] };
  }
  return globalStore.__baxterCronMetrics;
}

export function resetCronMetricsForTests() {
  globalStore.__baxterCronMetrics = { invocations: [] };
}

export function recordCronInvocation(input: { ok: boolean; code: string | null }) {
  const state = getState();
  state.invocations.unshift({
    at: new Date().toISOString(),
    ok: input.ok,
    code: input.code,
  });
  if (state.invocations.length > 50) state.invocations.length = 50;
}

export function getCronMetricsSnapshot() {
  const state = getState();
  const lastOk = state.invocations.find((i) => i.ok);
  const lastFail = state.invocations.find((i) => !i.ok);
  return {
    lastCronInvocation: state.invocations[0]?.at ?? null,
    lastSuccessfulJobProcessingRun: lastOk?.at ?? null,
    lastFailedJobProcessingRun: lastFail?.at ?? null,
    lastFailureCode: lastFail?.code ?? null,
  };
}
