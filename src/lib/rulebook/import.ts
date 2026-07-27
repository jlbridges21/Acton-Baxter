import "server-only";

/**
 * Import parsed Process Rulebook into database.
 * Creates NEW DRAFT versions only — never modifies active versions.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import type { ParsedRulebook, ValidationReport } from "./types";

export type ImportRulebookOptions = {
  sourceDescription?: string;
  sourceReference?: string;
  importedBy?: string;
};

export type ImportRulebookResult = {
  success: boolean;
  versionId?: string;
  versionNumber?: number;
  error?: string;
  validationReport: ValidationReport;
};

/**
 * Import a parsed rulebook as a new DRAFT version.
 */
export async function importParsedRulebook(
  parsed: ParsedRulebook,
  validationReport: ValidationReport,
  options: ImportRulebookOptions = {},
): Promise<ImportRulebookResult> {
  const supabase = createServiceClient();

  try {
    // Get next version number
    const { data: maxVersionData, error: maxVersionError } = await supabase
      .from("rulebook_versions")
      .select("version_number")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxVersionError) {
      throw maxVersionError;
    }

    const nextVersionNumber = maxVersionData ? maxVersionData.version_number + 1 : 1;

    // Always create a draft (even when invalid) so admins can review the validation report.
    // Structure rows are only inserted when the report has no errors.
    const { data: version, error: versionError } = await supabase
      .from("rulebook_versions")
      .insert({
        version_number: nextVersionNumber,
        status: "draft",
        source_description: options.sourceDescription || null,
        source_reference: options.sourceReference || null,
        imported_by: options.importedBy || null,
        validation_report_json: validationReport,
      })
      .select("id, version_number")
      .single();

    if (versionError || !version) {
      throw versionError || new Error("Failed to create version");
    }

    if (!validationReport.valid) {
      return {
        success: true,
        versionId: version.id,
        versionNumber: version.version_number,
        error:
          "Draft created with validation errors. Fix and re-import, or resolve before activation.",
        validationReport,
      };
    }

    const versionId = version.id;

    // Upsert roles (roles are shared across versions)
    if (parsed.roles.length > 0) {
      const { error: rolesError } = await supabase.from("process_roles").upsert(
        parsed.roles.map((role) => ({
          role_key: role.role_key,
          display_name: role.display_name,
          description: role.description || null,
        })),
        {
          onConflict: "role_key",
          ignoreDuplicates: false,
        },
      );

      if (rolesError) {
        throw rolesError;
      }
    }

    // Insert stages
    const stageMap = new Map<string, string>(); // stage_key → stage_id

    if (parsed.stages.length > 0) {
      const { data: stages, error: stagesError } = await supabase
        .from("process_stages")
        .insert(
          parsed.stages.map((stage) => ({
            version_id: versionId,
            stage_key: stage.stage_key,
            display_name: stage.display_name,
            external_stage_name: stage.external_stage_name || null,
            order_index: stage.order_index,
            duration_days_budget: stage.duration_days_budget || null,
            description: stage.description || null,
          })),
        )
        .select("id, stage_key");

      if (stagesError || !stages) {
        throw stagesError || new Error("Failed to insert stages");
      }

      for (const stage of stages) {
        stageMap.set(stage.stage_key, stage.id);
      }
    }

    // Insert steps
    const stepMap = new Map<string, string>(); // step_key → step_id

    if (parsed.steps.length > 0) {
      const { data: steps, error: stepsError } = await supabase
        .from("process_steps")
        .insert(
          parsed.steps.map((step) => {
            const stageId = stageMap.get(step.stage_key);
            if (!stageId) {
              throw new Error(`Stage not found for step: ${step.step_key}`);
            }

            return {
              version_id: versionId,
              stage_id: stageId,
              step_key: step.step_key,
              display_name: step.display_name,
              order_index: step.order_index,
              duration_days_budget: step.duration_days_budget || null,
              description: step.description || null,
            };
          }),
        )
        .select("id, step_key");

      if (stepsError || !steps) {
        throw stepsError || new Error("Failed to insert steps");
      }

      for (const step of steps) {
        stepMap.set(step.step_key, step.id);
      }
    }

    // Insert RACI
    if (parsed.raci.length > 0) {
      const { error: raciError } = await supabase.from("process_step_raci").insert(
        parsed.raci.map((raci) => {
          const stepId = stepMap.get(raci.step_key);
          if (!stepId) {
            throw new Error(`Step not found for RACI: ${raci.step_key}`);
          }

          return {
            step_id: stepId,
            role_key: raci.role_key,
            raci: raci.raci,
          };
        }),
      );

      if (raciError) {
        throw raciError;
      }
    }

    // Insert data requirements
    if (parsed.data_requirements.length > 0) {
      const { error: dataReqError } = await supabase.from("process_step_data_requirements").insert(
        parsed.data_requirements.map((req) => {
          const stepId = stepMap.get(req.step_key);
          if (!stepId) {
            throw new Error(`Step not found for data requirement: ${req.step_key}`);
          }

          return {
            step_id: stepId,
            field_key: req.field_key,
            display_name: req.display_name,
            source_system: req.source_system,
            source_field_path: req.source_field_path || null,
            required: req.required !== undefined ? req.required : true,
            description: req.description || null,
          };
        }),
      );

      if (dataReqError) {
        throw dataReqError;
      }
    }

    return {
      success: true,
      versionId,
      versionNumber: nextVersionNumber,
      validationReport,
    };
  } catch (error) {
    console.error("Error importing rulebook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      validationReport,
    };
  }
}
