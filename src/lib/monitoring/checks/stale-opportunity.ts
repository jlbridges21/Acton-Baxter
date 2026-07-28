import "server-only";

import { getStaleOpportunities } from "@/lib/connectors/ghl/insights";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

const MONITOR_MAX_ITEMS = 2_000;
const MONITOR_MAX_PAGES = 40;

export const staleOpportunityCheck: MonitoringCheck = {
  key: "stale-opportunity",
  description: "Detect opportunities that haven't been updated in N days",

  async run(ctx: MonitoringContext) {
    const { settings, mappings } = ctx;
    const candidates: FindingCandidate[] = [];
    let incomplete = false;
    let incompleteReason: string | null = null;
    let recordsEvaluated = 0;

    if (settings.monitored_pipeline_ids.length === 0) {
      return { candidates: [] };
    }

    for (const pipelineId of settings.monitored_pipeline_ids) {
      const pipelineMappings = mappings.filter(
        (m) => m.ghl_pipeline_id === pipelineId && m.enabled,
      );

      // Only configured/mapped stages — do not scan Closed Won when unmapped.
      for (const mapping of pipelineMappings) {
        const staleDays =
          settings.stage_stale_overrides[`${pipelineId}:${mapping.ghl_stage_id}`] ??
          settings.default_stale_days;

        const result = await getStaleOpportunities({
          daysSinceUpdate: staleDays,
          pipelineId,
          pipelineStageId: mapping.ghl_stage_id,
          status: "open",
          maxItems: MONITOR_MAX_ITEMS,
          maxPages: MONITOR_MAX_PAGES,
        });

        recordsEvaluated += result.scannedCount;
        if (result.truncated || result.incomplete) {
          incomplete = true;
          incompleteReason =
            result.incompleteReason ||
            `Stale check incomplete for stage ${mapping.ghl_stage_name || mapping.ghl_stage_id}`;
        }

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

    if (incomplete) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:partial_stale",
        severity: "critical",
        entityType: "feed",
        title: "Incomplete stale-opportunity scan",
        evidence: { reason: incompleteReason, checkKey: "stale-opportunity" },
        recommendation:
          "Baxter could not finish reading staged opportunities. Do not treat the CRM as fully checked.",
      });
    }

    return { candidates, incomplete, incompleteReason, recordsEvaluated };
  },
};
