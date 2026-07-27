import "server-only";

import { getStaleOpportunities } from "@/lib/connectors/ghl/insights";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Check for stale opportunities in monitored pipelines.
 */
export const staleOpportunityCheck: MonitoringCheck = {
  key: "stale-opportunity",
  description: "Detect opportunities that haven't been updated in N days",

  async run(ctx: MonitoringContext): Promise<FindingCandidate[]> {
    const { settings, mappings } = ctx;
    const candidates: FindingCandidate[] = [];

    if (settings.monitored_pipeline_ids.length === 0) {
      return [];
    }

    for (const pipelineId of settings.monitored_pipeline_ids) {
      const pipelineMappings = mappings.filter(
        (m) => m.ghl_pipeline_id === pipelineId && m.enabled,
      );

      for (const mapping of pipelineMappings) {
        const staleDays =
          settings.stage_stale_overrides[`${pipelineId}:${mapping.ghl_stage_id}`] ??
          settings.default_stale_days;

        const result = await getStaleOpportunities({
          daysSinceUpdate: staleDays,
          pipelineId,
          pipelineStageId: mapping.ghl_stage_id,
          status: "open",
          maxItems: 100,
        });

        for (const row of result.rows) {
          candidates.push({
            checkKey: "stale-opportunity",
            dedupeKey: `ghl_stale_opportunity:${row.opportunityId}`,
            severity: row.daysStale >= staleDays * 2 ? "critical" : "warning",
            entityType: "opportunity",
            entityId: row.opportunityId,
            opportunityId: row.opportunityId,
            contactId: row.contactId || undefined,
            rulebookStageKey: mapping.rulebook_stage_key,
            rulebookStepKey: mapping.rulebook_step_key || undefined,
            title: `Stale opportunity (${row.daysStale}d): ${row.opportunityName}`,
            evidence: {
              opportunityName: row.opportunityName,
              contactName: row.contactName,
              pipelineName: row.pipelineName,
              stageName: row.stageName,
              ownerName: row.ownerName,
              lastUpdated: row.lastUpdated,
              daysStale: row.daysStale,
              staleDaysThreshold: staleDays,
            },
            recommendation: `Update this opportunity or move it forward. It has been ${row.daysStale} days since the last update.`,
          });
        }
      }
    }

    return candidates;
  },
};
