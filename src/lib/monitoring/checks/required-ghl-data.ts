import "server-only";

import { searchOpportunitiesPaginated } from "@/lib/connectors/ghl/resources/opportunities";
import { getContactById } from "@/lib/connectors/ghl/resources/contacts";
import { getOpportunityById } from "@/lib/connectors/ghl/resources/opportunities";
import { getRequiredData } from "@/lib/rulebook/api";
import { listCustomFields } from "@/lib/connectors/ghl/resources/custom-fields";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Check for missing required GHL data per rulebook mappings.
 */
export const requiredGhlDataCheck: MonitoringCheck = {
  key: "required-ghl-data",
  description: "Detect missing required GHL fields per process rulebook",

  async run(ctx: MonitoringContext) {
    const { settings, mappings, activeRulebook } = ctx;
    const candidates: FindingCandidate[] = [];
    let incomplete = false;
    let incompleteReason: string | null = null;
    let recordsEvaluated = 0;

    if (!activeRulebook) {
      return { candidates: [] };
    }

    if (settings.monitored_pipeline_ids.length === 0) {
      return { candidates: [] };
    }

    // Load custom field catalog
    const customFields = await listCustomFields({ useCache: true });
    const contactFields = customFields.filter((f) => f.model === "contact");
    const opportunityFields = customFields.filter((f) => f.model === "opportunity");

    const contactFieldKeys = new Set(contactFields.map((f) => f.fieldKey));
    const opportunityFieldKeys = new Set(opportunityFields.map((f) => f.fieldKey));

    for (const mapping of mappings) {
      if (!mapping.enabled) {
        continue;
      }

      if (!settings.monitored_pipeline_ids.includes(mapping.ghl_pipeline_id)) {
        continue;
      }

      if (!mapping.rulebook_step_key) {
        continue;
      }

      const requirements = await getRequiredData(mapping.rulebook_step_key);
      if (requirements.length === 0) {
        continue;
      }

      const ghlRequirements = requirements.filter((r) => r.source_system === "ghl");
      if (ghlRequirements.length === 0) {
        continue;
      }

      // Fetch opportunities in this pipeline+stage
      const opps = await searchOpportunitiesPaginated({
        pipelineId: mapping.ghl_pipeline_id,
        pipelineStageId: mapping.ghl_stage_id,
        status: "open",
        maxItems: 2000,
        maxPages: 40,
        limit: 50,
      });

      recordsEvaluated += opps.opportunities.length;
      if (opps.incomplete || opps.truncated) {
        incomplete = true;
        incompleteReason =
          opps.incompleteReason ||
          `Required-data check incomplete for stage ${mapping.ghl_stage_name || mapping.ghl_stage_id}`;
      }

      for (const opp of opps.opportunities) {
        const missingFields: string[] = [];

        for (const req of ghlRequirements) {
          if (!req.source_field_path) {
            continue;
          }

          const [model, fieldKey] = req.source_field_path.split(".");
          if (!model || !fieldKey) {
            continue;
          }

          let hasValue = false;

          if (model === "contact" && opp.contactId) {
            if (!contactFieldKeys.has(fieldKey)) {
              // Field doesn't exist in catalog — skip (config check handles this)
              continue;
            }

            const contact = await getContactById(opp.contactId).catch(() => null);
            if (contact) {
              const value = contact.customFields?.[fieldKey];
              hasValue = value !== null && value !== undefined && value !== "";
            }
          } else if (model === "opportunity") {
            if (!opportunityFieldKeys.has(fieldKey)) {
              continue;
            }

            const fullOpp = await getOpportunityById(opp.id).catch(() => null);
            if (fullOpp) {
              const value = fullOpp.customFields?.[fieldKey];
              hasValue = value !== null && value !== undefined && value !== "";
            }
          }

          if (!hasValue) {
            missingFields.push(req.display_name);
          }
        }

        if (missingFields.length > 0) {
          candidates.push({
            checkKey: "required-ghl-data",
            dedupeKey: `ghl_missing_data:${opp.id}:${missingFields.join(",")}`,
            severity: "warning",
            entityType: "opportunity",
            entityId: opp.id,
            opportunityId: opp.id,
            contactId: opp.contactId || undefined,
            rulebookStageKey: mapping.rulebook_stage_key,
            rulebookStepKey: mapping.rulebook_step_key,
            title: `Missing required data for ${opp.name}`,
            evidence: {
              opportunityName: opp.name,
              pipelineName: mapping.ghl_pipeline_name,
              stageName: mapping.ghl_stage_name,
              missingFields,
            },
            recommendation: `Fill in the following required fields: ${missingFields.join(", ")}`,
          });
        }
      }
    }

    if (incomplete) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:partial_required_data",
        severity: "critical",
        entityType: "feed",
        title: "Incomplete required-data scan",
        evidence: { reason: incompleteReason, checkKey: "required-ghl-data" },
        recommendation:
          "Baxter could not finish reading mapped opportunities. Do not treat required-data coverage as complete.",
      });
    }

    return { candidates, incomplete, incompleteReason, recordsEvaluated };
  },
};
