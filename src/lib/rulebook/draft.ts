import "server-only";

/**
 * Draft rulebook editing — CRUD for stages, steps, RACI, data requirements, and roles.
 * Active versions are IMMUTABLE. All edits operate on draft versions only.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import { recordRulebookAudit } from "./audit";
import { validateParsedRulebook } from "./validator";
import { loadRulebookTree } from "./versions";
import type { ParsedRulebook, SourceSystem } from "./types";
import { slugifyKey, ensureUniqueKey } from "./keys";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Assert that a version exists and is draft.
 */
export async function assertDraftEditable(versionId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: version, error } = await supabase
    .from("rulebook_versions")
    .select("id, status")
    .eq("id", versionId)
    .single();

  if (error || !version) {
    throw new Error("Version not found");
  }

  if (version.status !== "draft") {
    throw new Error(`Cannot edit ${version.status} version. Only draft versions can be edited.`);
  }
}

/**
 * Load a draft version as ParsedRulebook for re-validation.
 */
async function loadDraftAsParsed(versionId: string): Promise<ParsedRulebook> {
  const supabase = createServiceClient();

  // Load all roles (not version-specific)
  const { data: rolesData } = await supabase
    .from("process_roles")
    .select("role_key, display_name, description");

  // Load stages
  const { data: stagesData } = await supabase
    .from("process_stages")
    .select(
      "stage_key, display_name, external_stage_name, order_index, duration_days_budget, description",
    )
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });

  // Load steps
  const { data: stepsData } = await supabase
    .from("process_steps")
    .select("step_key, stage_id, display_name, order_index, duration_days_budget, description")
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });

  // Load stages to map stage_id -> stage_key
  const { data: stagesForMapping } = await supabase
    .from("process_stages")
    .select("id, stage_key")
    .eq("version_id", versionId);

  const stageIdToKey = new Map<string, string>();
  for (const stage of stagesForMapping || []) {
    stageIdToKey.set(stage.id, stage.stage_key);
  }

  const { data: stepsWithIds } = await supabase
    .from("process_steps")
    .select("id, step_key")
    .eq("version_id", versionId);

  const stepIdToKey = new Map<string, string>();
  for (const step of stepsWithIds || []) {
    stepIdToKey.set(step.id, step.step_key);
  }

  const { data: raciActualData } = await supabase
    .from("process_step_raci")
    .select("step_id, role_key, raci")
    .in(
      "step_id",
      (stepsWithIds || []).map((s) => s.id),
    );

  // Load data requirements
  const { data: dataReqData } = await supabase
    .from("process_step_data_requirements")
    .select(
      "step_id, field_key, display_name, source_system, source_field_path, required, description",
    )
    .in(
      "step_id",
      (stepsWithIds || []).map((s) => s.id),
    );

  const parsed: ParsedRulebook = {
    roles: (rolesData || []).map((r) => ({
      role_key: r.role_key,
      display_name: r.display_name,
      description: r.description || undefined,
    })),
    stages: (stagesData || []).map((s) => ({
      stage_key: s.stage_key,
      display_name: s.display_name,
      external_stage_name: s.external_stage_name || undefined,
      order_index: s.order_index,
      duration_days_budget: s.duration_days_budget || undefined,
      description: s.description || undefined,
    })),
    steps: (stepsData || []).map((s) => ({
      step_key: s.step_key,
      stage_key: stageIdToKey.get(s.stage_id) || "",
      display_name: s.display_name,
      order_index: s.order_index,
      duration_days_budget: s.duration_days_budget || undefined,
      description: s.description || undefined,
    })),
    raci: (raciActualData || []).map((r) => ({
      step_key: stepIdToKey.get(r.step_id) || "",
      role_key: r.role_key,
      raci: r.raci as "R" | "A" | "C" | "I",
    })),
    data_requirements: (dataReqData || []).map((d) => ({
      step_key: stepIdToKey.get(d.step_id) || "",
      field_key: d.field_key,
      display_name: d.display_name,
      source_system: d.source_system as SourceSystem,
      source_field_path: d.source_field_path || undefined,
      required: d.required,
      description: d.description || undefined,
    })),
  };

  return parsed;
}

/**
 * Re-validate a draft and update its validation report.
 */
async function revalidateDraft(versionId: string): Promise<void> {
  const parsed = await loadDraftAsParsed(versionId);
  const report = validateParsedRulebook(parsed);

  const supabase = createServiceClient();
  await supabase
    .from("rulebook_versions")
    .update({ validation_report_json: report })
    .eq("id", versionId);
}

// ============================================================================
// Draft creation
// ============================================================================

/**
 * Create a new draft by deep-copying an existing version.
 */
export async function createDraftFromVersion(
  sourceVersionId: string,
  actorUserId: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const supabase = createServiceClient();

  // Load source tree
  const sourceTree = await loadRulebookTree(sourceVersionId);
  if (!sourceTree) {
    throw new Error("Source version not found");
  }

  // Get next version number
  const { data: maxVersionData } = await supabase
    .from("rulebook_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNumber = maxVersionData ? maxVersionData.version_number + 1 : 1;

  // Create new draft version
  const { data: newVersion, error: versionError } = await supabase
    .from("rulebook_versions")
    .insert({
      version_number: nextVersionNumber,
      status: "draft",
      source_description: `Copy of version ${sourceTree.version_number}`,
      source_reference: sourceVersionId,
      imported_by: actorUserId,
      validation_report_json: sourceTree.validation_report_json,
    })
    .select("id, version_number")
    .single();

  if (versionError || !newVersion) {
    throw versionError || new Error("Failed to create draft version");
  }

  const newVersionId = newVersion.id;

  // Copy stages
  const stageIdMap = new Map<string, string>(); // old ID -> new ID

  for (const stage of sourceTree.stages) {
    const { data: newStage } = await supabase
      .from("process_stages")
      .insert({
        version_id: newVersionId,
        stage_key: stage.stage_key,
        display_name: stage.display_name,
        external_stage_name: stage.external_stage_name,
        order_index: stage.order_index,
        duration_days_budget: stage.duration_days_budget,
        description: stage.description,
      })
      .select("id")
      .single();

    if (newStage) {
      stageIdMap.set(stage.id, newStage.id);
    }
  }

  // Copy steps, RACI, and data requirements
  for (const stage of sourceTree.stages) {
    const newStageId = stageIdMap.get(stage.id);
    if (!newStageId) continue;

    for (const step of stage.steps) {
      const { data: newStep } = await supabase
        .from("process_steps")
        .insert({
          version_id: newVersionId,
          stage_id: newStageId,
          step_key: step.step_key,
          display_name: step.display_name,
          order_index: step.order_index,
          duration_days_budget: step.duration_days_budget,
          description: step.description,
        })
        .select("id")
        .single();

      if (!newStep) continue;

      // Copy RACI
      if (step.raci.length > 0) {
        await supabase.from("process_step_raci").insert(
          step.raci.map((r) => ({
            step_id: newStep.id,
            role_key: r.role_key,
            raci: r.raci,
          })),
        );
      }

      // Copy data requirements
      if (step.data_requirements.length > 0) {
        await supabase.from("process_step_data_requirements").insert(
          step.data_requirements.map((d) => ({
            step_id: newStep.id,
            field_key: d.field_key,
            display_name: d.display_name,
            source_system: d.source_system,
            source_field_path: d.source_field_path,
            required: d.required,
            description: d.description,
          })),
        );
      }
    }
  }

  // Re-validate
  await revalidateDraft(newVersionId);

  // Audit
  await recordRulebookAudit({
    actorUserId,
    action: "create_draft_from_version",
    versionId: newVersionId,
    summary: `Created draft v${nextVersionNumber} from version ${sourceTree.version_number}`,
  });

  return {
    versionId: newVersionId,
    versionNumber: nextVersionNumber,
  };
}

/**
 * Create an empty draft version with no stages/steps.
 */
export async function createEmptyDraft(
  actorUserId: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const supabase = createServiceClient();

  // Get next version number
  const { data: maxVersionData } = await supabase
    .from("rulebook_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNumber = maxVersionData ? maxVersionData.version_number + 1 : 1;

  // Create new draft version
  const { data: newVersion, error: versionError } = await supabase
    .from("rulebook_versions")
    .insert({
      version_number: nextVersionNumber,
      status: "draft",
      source_description: "Empty draft",
      imported_by: actorUserId,
      validation_report_json: { valid: false, errors: [], warnings: [] },
    })
    .select("id, version_number")
    .single();

  if (versionError || !newVersion) {
    throw versionError || new Error("Failed to create empty draft");
  }

  // Audit
  await recordRulebookAudit({
    actorUserId,
    action: "create_empty_draft",
    versionId: newVersion.id,
    summary: `Created empty draft v${nextVersionNumber}`,
  });

  return {
    versionId: newVersion.id,
    versionNumber: newVersion.version_number,
  };
}

// ============================================================================
// Stage CRUD
// ============================================================================

export async function addStage(
  versionId: string,
  stage: {
    displayName: string;
    description?: string;
    durationDaysBudget?: number;
    externalStageName?: string;
  },
  actorUserId: string,
): Promise<{ stageId: string }> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get existing stages to determine order_index and ensure unique key
  const { data: existingStages } = await supabase
    .from("process_stages")
    .select("stage_key, order_index")
    .eq("version_id", versionId)
    .order("order_index", { ascending: false });

  const existingKeys = new Set((existingStages || []).map((s) => s.stage_key));
  const maxOrder =
    existingStages && existingStages.length > 0 ? (existingStages[0]?.order_index ?? -1) : -1;

  const baseKey = slugifyKey(stage.displayName);
  const stageKey = ensureUniqueKey(baseKey, existingKeys);
  const orderIndex = maxOrder + 1;

  const { data: newStage, error } = await supabase
    .from("process_stages")
    .insert({
      version_id: versionId,
      stage_key: stageKey,
      display_name: stage.displayName,
      description: stage.description || null,
      duration_days_budget: stage.durationDaysBudget || null,
      external_stage_name: stage.externalStageName || null,
      order_index: orderIndex,
    })
    .select("id")
    .single();

  if (error || !newStage) {
    throw error || new Error("Failed to add stage");
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "add_stage",
    versionId,
    resourceType: "stage",
    resourceId: newStage.id,
    summary: `Added stage: ${stage.displayName}`,
    after: { stage_key: stageKey, display_name: stage.displayName },
  });

  return { stageId: newStage.id };
}

export async function updateStage(
  versionId: string,
  stageId: string,
  patch: {
    displayName?: string;
    description?: string;
    durationDaysBudget?: number;
    externalStageName?: string;
  },
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get current stage
  const { data: currentStage } = await supabase
    .from("process_stages")
    .select("*")
    .eq("id", stageId)
    .eq("version_id", versionId)
    .single();

  if (!currentStage) {
    throw new Error("Stage not found");
  }

  const updates: Record<string, unknown> = {};

  if (patch.displayName !== undefined) {
    updates.display_name = patch.displayName;
    // Do NOT change stage_key when display_name changes (per requirements)
  }

  if (patch.description !== undefined) {
    updates.description = patch.description || null;
  }

  if (patch.durationDaysBudget !== undefined) {
    updates.duration_days_budget = patch.durationDaysBudget || null;
  }

  if (patch.externalStageName !== undefined) {
    updates.external_stage_name = patch.externalStageName || null;
  }

  const { error } = await supabase
    .from("process_stages")
    .update(updates)
    .eq("id", stageId)
    .eq("version_id", versionId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "update_stage",
    versionId,
    resourceType: "stage",
    resourceId: stageId,
    summary: `Updated stage: ${currentStage.display_name}`,
    before: currentStage,
    after: updates,
  });
}

export async function deleteStage(
  versionId: string,
  stageId: string,
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get stage before delete (for audit)
  const { data: stage } = await supabase
    .from("process_stages")
    .select("display_name")
    .eq("id", stageId)
    .eq("version_id", versionId)
    .single();

  // Steps are cascade deleted via FK
  const { error } = await supabase
    .from("process_stages")
    .delete()
    .eq("id", stageId)
    .eq("version_id", versionId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "delete_stage",
    versionId,
    resourceType: "stage",
    resourceId: stageId,
    summary: `Deleted stage: ${stage?.display_name || stageId}`,
  });
}

export async function reorderStages(
  versionId: string,
  orderedStageIds: string[],
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Update order_index for each stage
  for (let i = 0; i < orderedStageIds.length; i++) {
    await supabase
      .from("process_stages")
      .update({ order_index: i })
      .eq("id", orderedStageIds[i])
      .eq("version_id", versionId);
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "reorder_stages",
    versionId,
    summary: `Reordered ${orderedStageIds.length} stages`,
  });
}

// ============================================================================
// Step CRUD
// ============================================================================

export async function addStep(
  versionId: string,
  stageId: string,
  step: {
    displayName: string;
    description?: string;
    durationDaysBudget?: number;
  },
  actorUserId: string,
): Promise<{ stepId: string }> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get existing steps in this stage to determine order_index and ensure unique key
  const { data: existingSteps } = await supabase
    .from("process_steps")
    .select("step_key, order_index")
    .eq("version_id", versionId)
    .order("order_index", { ascending: false });

  const existingKeys = new Set((existingSteps || []).map((s) => s.step_key));
  const { data: stageSteps } = await supabase
    .from("process_steps")
    .select("order_index")
    .eq("stage_id", stageId)
    .order("order_index", { ascending: false });

  const maxOrder = stageSteps && stageSteps.length > 0 ? (stageSteps[0]?.order_index ?? -1) : -1;

  const baseKey = slugifyKey(step.displayName);
  const stepKey = ensureUniqueKey(baseKey, existingKeys);
  const orderIndex = maxOrder + 1;

  const { data: newStep, error } = await supabase
    .from("process_steps")
    .insert({
      version_id: versionId,
      stage_id: stageId,
      step_key: stepKey,
      display_name: step.displayName,
      description: step.description || null,
      duration_days_budget: step.durationDaysBudget || null,
      order_index: orderIndex,
    })
    .select("id")
    .single();

  if (error || !newStep) {
    throw error || new Error("Failed to add step");
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "add_step",
    versionId,
    resourceType: "step",
    resourceId: newStep.id,
    summary: `Added step: ${step.displayName}`,
    after: { step_key: stepKey, display_name: step.displayName },
  });

  return { stepId: newStep.id };
}

export async function updateStep(
  versionId: string,
  stepId: string,
  patch: {
    displayName?: string;
    description?: string;
    durationDaysBudget?: number;
  },
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get current step
  const { data: currentStep } = await supabase
    .from("process_steps")
    .select("*")
    .eq("id", stepId)
    .eq("version_id", versionId)
    .single();

  if (!currentStep) {
    throw new Error("Step not found");
  }

  const updates: Record<string, unknown> = {};

  if (patch.displayName !== undefined) {
    updates.display_name = patch.displayName;
  }

  if (patch.description !== undefined) {
    updates.description = patch.description || null;
  }

  if (patch.durationDaysBudget !== undefined) {
    updates.duration_days_budget = patch.durationDaysBudget || null;
  }

  const { error } = await supabase
    .from("process_steps")
    .update(updates)
    .eq("id", stepId)
    .eq("version_id", versionId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "update_step",
    versionId,
    resourceType: "step",
    resourceId: stepId,
    summary: `Updated step: ${currentStep.display_name}`,
    before: currentStep,
    after: updates,
  });
}

export async function deleteStep(
  versionId: string,
  stepId: string,
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get step before delete (for audit)
  const { data: step } = await supabase
    .from("process_steps")
    .select("display_name")
    .eq("id", stepId)
    .eq("version_id", versionId)
    .single();

  const { error } = await supabase
    .from("process_steps")
    .delete()
    .eq("id", stepId)
    .eq("version_id", versionId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "delete_step",
    versionId,
    resourceType: "step",
    resourceId: stepId,
    summary: `Deleted step: ${step?.display_name || stepId}`,
  });
}

export async function reorderSteps(
  versionId: string,
  stageId: string,
  orderedStepIds: string[],
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Update order_index for each step
  for (let i = 0; i < orderedStepIds.length; i++) {
    await supabase
      .from("process_steps")
      .update({ order_index: i })
      .eq("id", orderedStepIds[i])
      .eq("stage_id", stageId)
      .eq("version_id", versionId);
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "reorder_steps",
    versionId,
    summary: `Reordered ${orderedStepIds.length} steps in stage`,
  });
}

export async function moveStep(
  versionId: string,
  stepId: string,
  toStageId: string,
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Get current step
  const { data: step } = await supabase
    .from("process_steps")
    .select("display_name, stage_id")
    .eq("id", stepId)
    .eq("version_id", versionId)
    .single();

  if (!step) {
    throw new Error("Step not found");
  }

  // Get max order in target stage
  const { data: targetSteps } = await supabase
    .from("process_steps")
    .select("order_index")
    .eq("stage_id", toStageId)
    .order("order_index", { ascending: false });

  const maxOrder = targetSteps && targetSteps.length > 0 ? (targetSteps[0]?.order_index ?? -1) : -1;

  // Move step
  const { error } = await supabase
    .from("process_steps")
    .update({
      stage_id: toStageId,
      order_index: maxOrder + 1,
    })
    .eq("id", stepId)
    .eq("version_id", versionId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "move_step",
    versionId,
    resourceType: "step",
    resourceId: stepId,
    summary: `Moved step ${step.display_name} to new stage`,
  });
}

// ============================================================================
// RACI
// ============================================================================

export async function setStepRaci(
  versionId: string,
  stepId: string,
  raci: {
    responsibleRoleKey: string | null;
    accountableRoleKey: string | null;
    consultedRoleKeys: string[];
    informedRoleKeys: string[];
  },
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Verify step belongs to version
  const { data: step } = await supabase
    .from("process_steps")
    .select("id")
    .eq("id", stepId)
    .eq("version_id", versionId)
    .single();

  if (!step) {
    throw new Error("Step not found");
  }

  // Delete existing RACI for this step
  await supabase.from("process_step_raci").delete().eq("step_id", stepId);

  // Insert new RACI
  const raciEntries: Array<{ step_id: string; role_key: string; raci: "R" | "A" | "C" | "I" }> = [];

  if (raci.responsibleRoleKey) {
    raciEntries.push({
      step_id: stepId,
      role_key: raci.responsibleRoleKey,
      raci: "R",
    });
  }

  if (raci.accountableRoleKey) {
    raciEntries.push({
      step_id: stepId,
      role_key: raci.accountableRoleKey,
      raci: "A",
    });
  }

  for (const roleKey of raci.consultedRoleKeys) {
    raciEntries.push({
      step_id: stepId,
      role_key: roleKey,
      raci: "C",
    });
  }

  for (const roleKey of raci.informedRoleKeys) {
    raciEntries.push({
      step_id: stepId,
      role_key: roleKey,
      raci: "I",
    });
  }

  if (raciEntries.length > 0) {
    const { error } = await supabase.from("process_step_raci").insert(raciEntries);
    if (error) {
      throw error;
    }
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "set_step_raci",
    versionId,
    resourceType: "step",
    resourceId: stepId,
    summary: `Updated RACI for step`,
    after: raci,
  });
}

// ============================================================================
// Data Requirements
// ============================================================================

export async function addDataRequirement(
  versionId: string,
  stepId: string,
  requirement: {
    fieldKey: string;
    displayName: string;
    sourceSystem: SourceSystem;
    sourceFieldPath?: string;
    required?: boolean;
    description?: string;
  },
  actorUserId: string,
): Promise<{ requirementId: string }> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Verify step belongs to version
  const { data: step } = await supabase
    .from("process_steps")
    .select("id")
    .eq("id", stepId)
    .eq("version_id", versionId)
    .single();

  if (!step) {
    throw new Error("Step not found");
  }

  const { data: newReq, error } = await supabase
    .from("process_step_data_requirements")
    .insert({
      step_id: stepId,
      field_key: requirement.fieldKey,
      display_name: requirement.displayName,
      source_system: requirement.sourceSystem,
      source_field_path: requirement.sourceFieldPath || null,
      required: requirement.required !== undefined ? requirement.required : true,
      description: requirement.description || null,
    })
    .select("id")
    .single();

  if (error || !newReq) {
    throw error || new Error("Failed to add data requirement");
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "add_data_requirement",
    versionId,
    resourceType: "data_requirement",
    resourceId: newReq.id,
    summary: `Added data requirement: ${requirement.displayName}`,
    after: requirement,
  });

  return { requirementId: newReq.id };
}

export async function updateDataRequirement(
  versionId: string,
  requirementId: string,
  patch: {
    fieldKey?: string;
    displayName?: string;
    sourceSystem?: SourceSystem;
    sourceFieldPath?: string;
    required?: boolean;
    description?: string;
  },
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Verify requirement belongs to a step in this version
  const { data: currentReq } = await supabase
    .from("process_step_data_requirements")
    .select("*, process_steps!inner(version_id)")
    .eq("id", requirementId)
    .single();

  if (!currentReq || currentReq.process_steps?.version_id !== versionId) {
    throw new Error("Data requirement not found");
  }

  const updates: Record<string, unknown> = {};

  if (patch.fieldKey !== undefined) updates.field_key = patch.fieldKey;
  if (patch.displayName !== undefined) updates.display_name = patch.displayName;
  if (patch.sourceSystem !== undefined) updates.source_system = patch.sourceSystem;
  if (patch.sourceFieldPath !== undefined)
    updates.source_field_path = patch.sourceFieldPath || null;
  if (patch.required !== undefined) updates.required = patch.required;
  if (patch.description !== undefined) updates.description = patch.description || null;

  const { error } = await supabase
    .from("process_step_data_requirements")
    .update(updates)
    .eq("id", requirementId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "update_data_requirement",
    versionId,
    resourceType: "data_requirement",
    resourceId: requirementId,
    summary: `Updated data requirement`,
    before: currentReq,
    after: updates,
  });
}

export async function deleteDataRequirement(
  versionId: string,
  requirementId: string,
  actorUserId: string,
): Promise<void> {
  await assertDraftEditable(versionId);

  const supabase = createServiceClient();

  // Verify requirement belongs to a step in this version
  const { data: req } = await supabase
    .from("process_step_data_requirements")
    .select("display_name, step_id, process_steps!inner(version_id)")
    .eq("id", requirementId)
    .single();

  const stepJoin = req?.process_steps as { version_id?: string } | { version_id?: string }[] | null;
  const stepVersionId = Array.isArray(stepJoin) ? stepJoin[0]?.version_id : stepJoin?.version_id;
  if (!req || stepVersionId !== versionId) {
    throw new Error("Data requirement not found");
  }

  const { error } = await supabase
    .from("process_step_data_requirements")
    .delete()
    .eq("id", requirementId);

  if (error) {
    throw error;
  }

  await revalidateDraft(versionId);
  await recordRulebookAudit({
    actorUserId,
    action: "delete_data_requirement",
    versionId,
    resourceType: "data_requirement",
    resourceId: requirementId,
    summary: `Deleted data requirement: ${req.display_name || requirementId}`,
  });
}

// ============================================================================
// Roles (process roles are shared across versions)
// ============================================================================

export async function createRole(
  role: {
    roleKey?: string;
    displayName: string;
    description?: string;
  },
  actorUserId: string,
): Promise<{ roleKey: string }> {
  const supabase = createServiceClient();

  // Get existing roles to ensure unique key
  const { data: existingRoles } = await supabase.from("process_roles").select("role_key");

  const existingKeys = new Set((existingRoles || []).map((r) => r.role_key));

  const baseKey = role.roleKey || slugifyKey(role.displayName);
  const roleKey = ensureUniqueKey(baseKey, existingKeys);

  const { error } = await supabase.from("process_roles").insert({
    role_key: roleKey,
    display_name: role.displayName,
    description: role.description || null,
  });

  if (error) {
    throw error;
  }

  await recordRulebookAudit({
    actorUserId,
    action: "create_role",
    resourceType: "role",
    resourceId: roleKey,
    summary: `Created role: ${role.displayName}`,
    after: { role_key: roleKey, display_name: role.displayName },
  });

  return { roleKey };
}

export async function updateRole(
  roleKey: string,
  patch: {
    displayName?: string;
    description?: string;
  },
  actorUserId: string,
): Promise<void> {
  const supabase = createServiceClient();

  const updates: Record<string, unknown> = {};

  if (patch.displayName !== undefined) updates.display_name = patch.displayName;
  if (patch.description !== undefined) updates.description = patch.description || null;

  const { error } = await supabase.from("process_roles").update(updates).eq("role_key", roleKey);

  if (error) {
    throw error;
  }

  await recordRulebookAudit({
    actorUserId,
    action: "update_role",
    resourceType: "role",
    resourceId: roleKey,
    summary: `Updated role: ${roleKey}`,
    after: updates,
  });
}

export async function retireRole(roleKey: string, actorUserId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("process_roles")
    .update({ status: "retired" })
    .eq("role_key", roleKey);

  if (error) {
    throw error;
  }

  await recordRulebookAudit({
    actorUserId,
    action: "retire_role",
    resourceType: "role",
    resourceId: roleKey,
    summary: `Retired role: ${roleKey}`,
  });
}
