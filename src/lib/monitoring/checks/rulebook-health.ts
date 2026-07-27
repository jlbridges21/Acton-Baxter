import "server-only";

import { listCustomFields } from "@/lib/connectors/ghl/resources/custom-fields";
import { getRequiredData } from "@/lib/rulebook/api";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Check rulebook configuration health.
 */
export const rulebookHealthCheck: MonitoringCheck = {
  key: "rulebook-health",
  description: "Verify process rulebook configuration completeness",

  async run(ctx: MonitoringContext): Promise<FindingCandidate[]> {
    const { activeRulebook, mappings, settings } = ctx;
    const candidates: FindingCandidate[] = [];

    if (!activeRulebook) {
      candidates.push({
        checkKey: "rulebook-health",
        dedupeKey: "rulebook_health:no_active_rulebook",
        severity: "critical",
        entityType: "configuration",
        title: "No active rulebook",
        evidence: {
          reason: "No active process rulebook version found",
        },
        recommendation: "Import and activate a process rulebook in admin settings.",
      });
      return candidates;
    }

    // Check monitored pipelines have stage mappings
    const monitoredPipelines = settings.monitored_pipeline_ids;
    if (monitoredPipelines.length > 0) {
      for (const pipelineId of monitoredPipelines) {
        const pipelineMappings = mappings.filter(
          (m) => m.ghl_pipeline_id === pipelineId && m.enabled,
        );

        if (pipelineMappings.length === 0) {
          candidates.push({
            checkKey: "rulebook-health",
            dedupeKey: `rulebook_health:no_mappings:${pipelineId}`,
            severity: "warning",
            entityType: "configuration",
            title: `No rulebook mappings for monitored pipeline`,
            evidence: {
              pipelineId,
            },
            recommendation:
              "Create GHL pipeline/stage to rulebook mappings for this monitored pipeline.",
          });
          continue;
        }

        // Count unmapped stages
        const unmappedStagesCount = pipelineMappings.filter(
          (m) => !m.rulebook_stage_key || !m.rulebook_step_key,
        ).length;

        if (unmappedStagesCount > 0) {
          candidates.push({
            checkKey: "rulebook-health",
            dedupeKey: `rulebook_health:incomplete_mappings:${pipelineId}`,
            severity: "info",
            entityType: "configuration",
            title: `${unmappedStagesCount} unmapped stages in monitored pipeline`,
            evidence: {
              pipelineId,
              unmappedStagesCount,
            },
            recommendation: "Complete stage-to-step mappings for all stages in this pipeline.",
          });
        }
      }
    }

    // Check for invalid field paths
    const enabledMappings = mappings.filter((m) => m.enabled && m.rulebook_step_key);
    const customFields = await listCustomFields({ useCache: true });
    const contactFieldKeys = new Set(
      customFields.filter((f) => f.model === "contact").map((f) => f.fieldKey),
    );
    const opportunityFieldKeys = new Set(
      customFields.filter((f) => f.model === "opportunity").map((f) => f.fieldKey),
    );

    for (const mapping of enabledMappings) {
      if (!mapping.rulebook_step_key) {
        continue;
      }

      const requirements = await getRequiredData(mapping.rulebook_step_key);
      const ghlRequirements = requirements.filter(
        (r) => r.source_system === "ghl" && r.source_field_path,
      );

      for (const req of ghlRequirements) {
        if (!req.source_field_path) {
          continue;
        }

        const [model, fieldKey] = req.source_field_path.split(".");
        if (!model || !fieldKey) {
          continue;
        }

        let fieldExists = false;
        if (model === "contact") {
          fieldExists = contactFieldKeys.has(fieldKey);
        } else if (model === "opportunity") {
          fieldExists = opportunityFieldKeys.has(fieldKey);
        }

        if (!fieldExists) {
          candidates.push({
            checkKey: "rulebook-health",
            dedupeKey: `rulebook_health:invalid_field_path:${mapping.rulebook_step_key}:${req.field_key}`,
            severity: "warning",
            entityType: "configuration",
            rulebookStageKey: mapping.rulebook_stage_key,
            rulebookStepKey: mapping.rulebook_step_key,
            title: `Invalid GHL field path: ${req.source_field_path}`,
            evidence: {
              fieldKey: req.field_key,
              displayName: req.display_name,
              sourcePath: req.source_field_path,
              step: mapping.rulebook_step_key,
            },
            recommendation: `Update field path or create custom field "${fieldKey}" in GHL ${model}s.`,
          });
        }
      }
    }

    return candidates;
  },
};
