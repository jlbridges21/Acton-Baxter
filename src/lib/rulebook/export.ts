import "server-only";

/**
 * Export rulebook versions as structured sheets for download.
 */

import { loadRulebookTree } from "./versions";
import { listProcessRoles } from "./roles";

export type SheetRow = Record<string, string>;
export type SheetExport = Record<string, SheetRow[]>;

/**
 * Export a rulebook version as structured sheets.
 * Returns tabs: Roles, Stages, Steps, RACI, DataRequirements.
 */
export async function exportRulebookAsSheets(versionId: string): Promise<SheetExport> {
  const tree = await loadRulebookTree(versionId);
  if (!tree) {
    throw new Error("Version not found");
  }

  const roles = await listProcessRoles();

  // Roles tab
  const rolesRows: SheetRow[] = roles.map((role) => ({
    role_key: role.role_key,
    display_name: role.display_name,
    description: role.description || "",
    status: (role as { status?: string }).status || "active",
  }));

  // Stages tab
  const stagesRows: SheetRow[] = tree.stages.map((stage) => ({
    stage_key: stage.stage_key,
    display_name: stage.display_name,
    external_stage_name: stage.external_stage_name || "",
    order_index: String(stage.order_index),
    duration_days_budget: stage.duration_days_budget ? String(stage.duration_days_budget) : "",
    description: stage.description || "",
  }));

  // Steps tab
  const stepsRows: SheetRow[] = [];
  for (const stage of tree.stages) {
    for (const step of stage.steps) {
      stepsRows.push({
        step_key: step.step_key,
        stage_key: stage.stage_key,
        display_name: step.display_name,
        order_index: String(step.order_index),
        duration_days_budget: step.duration_days_budget ? String(step.duration_days_budget) : "",
        description: step.description || "",
      });
    }
  }

  // RACI tab
  const raciRows: SheetRow[] = [];
  for (const stage of tree.stages) {
    for (const step of stage.steps) {
      for (const raci of step.raci) {
        raciRows.push({
          step_key: step.step_key,
          role_key: raci.role_key,
          raci: raci.raci,
        });
      }
    }
  }

  // DataRequirements tab
  const dataRequirementsRows: SheetRow[] = [];
  for (const stage of tree.stages) {
    for (const step of stage.steps) {
      for (const req of step.data_requirements) {
        dataRequirementsRows.push({
          step_key: step.step_key,
          field_key: req.field_key,
          display_name: req.display_name,
          source_system: req.source_system,
          source_field_path: req.source_field_path || "",
          required: String(req.required),
          description: req.description || "",
        });
      }
    }
  }

  return {
    Roles: rolesRows,
    Stages: stagesRows,
    Steps: stepsRows,
    RACI: raciRows,
    DataRequirements: dataRequirementsRows,
  };
}
