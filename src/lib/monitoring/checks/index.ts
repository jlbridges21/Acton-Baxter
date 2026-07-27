import "server-only";

import type { MonitoringCheck } from "./types";
import { unownedOpportunityCheck } from "./unowned-opportunity";
import { staleOpportunityCheck } from "./stale-opportunity";
import { requiredGhlDataCheck } from "./required-ghl-data";
import { feedHealthCheck } from "./feed-health";
import { rulebookHealthCheck } from "./rulebook-health";
import type { MonitoringContext } from "../types";

/**
 * Registry of all monitoring checks.
 */
export const ALL_CHECKS: MonitoringCheck[] = [
  unownedOpportunityCheck,
  staleOpportunityCheck,
  requiredGhlDataCheck,
  feedHealthCheck,
  rulebookHealthCheck,
];

/**
 * Get enabled checks based on settings.
 * - Operational checks (unowned, stale, required) only run if explicitly enabled
 * - Config/health checks (feed, rulebook) always run when monitoring is enabled
 */
export function getEnabledChecks(ctx: MonitoringContext): MonitoringCheck[] {
  const { settings } = ctx;
  const enabled: MonitoringCheck[] = [];

  for (const check of ALL_CHECKS) {
    const config = settings.check_configs[check.key];

    // Health checks default enabled
    if (check.key === "feed-health" || check.key === "rulebook-health") {
      if (config?.enabled === false) {
        continue;
      }
      enabled.push(check);
      continue;
    }

    // Operational checks default disabled
    if (config?.enabled === true) {
      enabled.push(check);
    }
  }

  return enabled;
}

export { unownedOpportunityCheck, staleOpportunityCheck, requiredGhlDataCheck };
export type { MonitoringCheck } from "./types";
