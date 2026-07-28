import "server-only";

import type { FindingCandidate, MonitoringContext } from "../types";

export type CheckRunResult = {
  candidates: FindingCandidate[];
  /** Dataset used by this check was incomplete (pagination ceiling / API interrupt). */
  incomplete?: boolean;
  incompleteReason?: string | null;
  recordsEvaluated?: number;
};

/**
 * Monitoring check interface.
 */
export type MonitoringCheck = {
  key: string;
  description: string;
  run(ctx: MonitoringContext): Promise<CheckRunResult>;
};

export function normalizeCheckRunResult(
  result: CheckRunResult | FindingCandidate[],
): CheckRunResult {
  if (Array.isArray(result)) {
    return { candidates: result };
  }
  return result;
}
