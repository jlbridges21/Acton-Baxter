import "server-only";

import { getUnownedOpportunities } from "@/lib/connectors/ghl/insights";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/** Monitor open opportunities only — Closed Won/Lost are out of scope for ownership alerts. */
const MONITOR_MAX_ITEMS = 2_000;
const MONITOR_MAX_PAGES = 40;

export const unownedOpportunityCheck: MonitoringCheck = {
  key: "unowned-opportunity",
  description: "Detect open opportunities without an assigned owner",

  async run(ctx: MonitoringContext) {
    const { settings } = ctx;
    const candidates: FindingCandidate[] = [];
    let incomplete = false;
    let incompleteReason: string | null = null;
    let recordsEvaluated = 0;

    if (settings.monitored_pipeline_ids.length === 0) {
      return { candidates: [] };
    }

    for (const pipelineId of settings.monitored_pipeline_ids) {
      const result = await getUnownedOpportunities({
        pipelineId,
        status: "open",
        maxItems: MONITOR_MAX_ITEMS,
        maxPages: MONITOR_MAX_PAGES,
      });

      recordsEvaluated += result.scannedCount;
      if (result.truncated || result.incomplete) {
        incomplete = true;
        incompleteReason =
          result.incompleteReason ||
          `Unowned check could not finish paging open opportunities in pipeline ${pipelineId}`;
      }

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

    if (incomplete) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:partial_unowned",
        severity: "critical",
        entityType: "feed",
        title: "Incomplete unowned-opportunity scan",
        evidence: { reason: incompleteReason, checkKey: "unowned-opportunity" },
        recommendation:
          "Baxter could not finish reading open opportunities. Do not treat operations as fully checked.",
      });
    }

    return { candidates, incomplete, incompleteReason, recordsEvaluated };
  },
};
