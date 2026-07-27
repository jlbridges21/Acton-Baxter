import "server-only";

import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Monitoring check interface.
 */
export type MonitoringCheck = {
  key: string;
  description: string;
  run(ctx: MonitoringContext): Promise<FindingCandidate[]>;
};
