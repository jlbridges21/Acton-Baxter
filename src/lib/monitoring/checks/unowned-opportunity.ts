import "server-only";

import { getUnownedOpportunities } from "@/lib/connectors/ghl/insights";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Check for unowned opportunities in monitored pipelines.
 */
export const unownedOpportunityCheck: MonitoringCheck = {
  key: "unowned-opportunity",
  description: "Detect open opportunities without an assigned owner",

  async run(ctx: MonitoringContext): Promise<FindingCandidate[]> {
    const { settings } = ctx;
    const candidates: FindingCandidate[] = [];

    if (settings.monitored_pipeline_ids.length === 0) {
      return [];
    }

    for (const pipelineId of settings.monitored_pipeline_ids) {
      const result = await getUnownedOpportunities({
        pipelineId,
        status: "open",
        maxItems: 100,
      });

      for (const row of result.rows) {
        candidates.push({
          checkKey: "unowned-opportunity",
          dedupeKey: `ghl_unowned_opportunity:${row.opportunityId}`,
          severity: "warning",
          entityType: "opportunity",
          entityId: row.opportunityId,
          opportunityId: row.opportunityId,
          contactId: row.contactId || undefined,
          title: `Unowned opportunity: ${row.opportunityName}`,
          evidence: {
            opportunityName: row.opportunityName,
            contactName: row.contactName,
            pipelineName: row.pipelineName,
            stageName: row.stageName,
            monetaryValue: row.monetaryValue,
          },
          recommendation: "Assign an owner to this opportunity or close it if no longer active.",
        });
      }
    }

    return candidates;
  },
};
