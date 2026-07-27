import "server-only";

/**
 * Version management for Process Rulebook.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import type {
  RulebookVersion,
  RulebookTree,
  RulebookTreeStage,
  RulebookTreeStep,
  RulebookDiffSummary,
} from "./types";

/**
 * Get the active rulebook version.
 */
export async function getActiveRulebook(): Promise<RulebookVersion | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("rulebook_versions")
    .select("*")
    .eq("status", "active")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // No active version
    }
    throw error;
  }

  return data;
}

/**
 * Get a specific rulebook version by ID.
 */
export async function getRulebookVersion(versionId: string): Promise<RulebookVersion | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("rulebook_versions")
    .select("*")
    .eq("id", versionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data;
}

/**
 * List all rulebook versions.
 */
export async function listRulebookVersions(): Promise<RulebookVersion[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("rulebook_versions")
    .select("*")
    .order("version_number", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get the next version number.
 */
export async function getNextVersionNumber(): Promise<number> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("rulebook_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data ? data.version_number + 1 : 1;
}

/**
 * Activate a draft rulebook version.
 * Supersedes the current active version if one exists.
 */
export async function activateRulebookVersion(
  versionId: string,
  activatedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient();

  try {
    // Check that the version exists and is draft
    const { data: version, error: versionError } = await supabase
      .from("rulebook_versions")
      .select("id, status, version_number")
      .eq("id", versionId)
      .single();

    if (versionError || !version) {
      return {
        success: false,
        error: "Version not found",
      };
    }

    if (version.status !== "draft") {
      return {
        success: false,
        error: `Cannot activate version with status: ${version.status}`,
      };
    }

    // Re-fetch validation report — refuse activation when errors exist
    const { data: fullVersion, error: fullError } = await supabase
      .from("rulebook_versions")
      .select("validation_report_json")
      .eq("id", versionId)
      .single();

    if (fullError || !fullVersion) {
      return { success: false, error: "Could not load validation report" };
    }

    const report = fullVersion.validation_report_json as {
      valid?: boolean;
      errors?: unknown[];
    } | null;
    if (
      report &&
      (report.valid === false || (Array.isArray(report.errors) && report.errors.length > 0))
    ) {
      return {
        success: false,
        error: "Cannot activate: validation errors must be resolved first.",
      };
    }

    // Get current active version
    const { data: activeVersion } = await supabase
      .from("rulebook_versions")
      .select("id")
      .eq("status", "active")
      .maybeSingle();

    // Mark current active as superseded
    if (activeVersion) {
      const { error: supersededError } = await supabase
        .from("rulebook_versions")
        .update({ status: "superseded" })
        .eq("id", activeVersion.id);

      if (supersededError) {
        throw supersededError;
      }
    }

    // Activate the new version
    const { error: activateError } = await supabase
      .from("rulebook_versions")
      .update({
        status: "active",
        activated_by: activatedBy,
        activated_at: new Date().toISOString(),
        superseded_version_id: activeVersion?.id || null,
      })
      .eq("id", versionId);

    if (activateError) {
      throw activateError;
    }

    const { noteActiveRulebookPresence } = await import("./capabilities");
    noteActiveRulebookPresence(true);

    return { success: true };
  } catch (error) {
    console.error("Error activating rulebook version:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Load full rulebook tree with nested stages, steps, RACI, and data requirements.
 */
export async function loadRulebookTree(versionId: string): Promise<RulebookTree | null> {
  const supabase = createServiceClient();

  // Get version
  const version = await getRulebookVersion(versionId);
  if (!version) {
    return null;
  }

  // Get stages
  const { data: stages, error: stagesError } = await supabase
    .from("process_stages")
    .select("*")
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });

  if (stagesError) {
    throw stagesError;
  }

  // Get steps
  const { data: steps, error: stepsError } = await supabase
    .from("process_steps")
    .select("*")
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });

  if (stepsError) {
    throw stepsError;
  }

  // Get RACI for all steps
  const stepIds = steps?.map((s) => s.id) || [];
  const { data: raciEntries, error: raciError } = await supabase
    .from("process_step_raci")
    .select("*")
    .in("step_id", stepIds);

  if (raciError) {
    throw raciError;
  }

  // Get data requirements for all steps
  const { data: dataRequirements, error: dataReqError } = await supabase
    .from("process_step_data_requirements")
    .select("*")
    .in("step_id", stepIds);

  if (dataReqError) {
    throw dataReqError;
  }

  // Build tree
  const raciByStep = new Map<string, typeof raciEntries>();
  const dataReqByStep = new Map<string, typeof dataRequirements>();

  for (const raci of raciEntries || []) {
    if (!raciByStep.has(raci.step_id)) {
      raciByStep.set(raci.step_id, []);
    }
    raciByStep.get(raci.step_id)!.push(raci);
  }

  for (const req of dataRequirements || []) {
    if (!dataReqByStep.has(req.step_id)) {
      dataReqByStep.set(req.step_id, []);
    }
    dataReqByStep.get(req.step_id)!.push(req);
  }

  const treeStages: RulebookTreeStage[] = (stages || []).map((stage) => {
    const stageSteps = (steps || []).filter((s) => s.stage_id === stage.id);

    const treeSteps: RulebookTreeStep[] = stageSteps.map((step) => ({
      ...step,
      raci: raciByStep.get(step.id) || [],
      data_requirements: dataReqByStep.get(step.id) || [],
    }));

    return {
      ...stage,
      steps: treeSteps,
    };
  });

  return {
    ...version,
    stages: treeStages,
  };
}

/**
 * Compare two rulebook versions and return a diff summary.
 */
export async function diffRulebookVersions(
  draftId: string,
  activeId: string,
): Promise<RulebookDiffSummary | null> {
  const supabase = createServiceClient();

  try {
    // Get stages for both versions
    const { data: draftStages } = await supabase
      .from("process_stages")
      .select("stage_key")
      .eq("version_id", draftId);

    const { data: activeStages } = await supabase
      .from("process_stages")
      .select("stage_key")
      .eq("version_id", activeId);

    // Get steps for both versions
    const { data: draftSteps } = await supabase
      .from("process_steps")
      .select("step_key")
      .eq("version_id", draftId);

    const { data: activeSteps } = await supabase
      .from("process_steps")
      .select("step_key")
      .eq("version_id", activeId);

    // Get RACI for both versions
    const { data: draftStepIds } = await supabase
      .from("process_steps")
      .select("id")
      .eq("version_id", draftId);

    const { data: activeStepIds } = await supabase
      .from("process_steps")
      .select("id")
      .eq("version_id", activeId);

    const { data: draftRaci } = await supabase
      .from("process_step_raci")
      .select("step_id, role_key, raci")
      .in("step_id", draftStepIds?.map((s) => s.id) || []);

    const { data: activeRaci } = await supabase
      .from("process_step_raci")
      .select("step_id, role_key, raci")
      .in("step_id", activeStepIds?.map((s) => s.id) || []);

    // Get data requirements for both versions
    const { data: draftDataReq } = await supabase
      .from("process_step_data_requirements")
      .select("step_id, field_key")
      .in("step_id", draftStepIds?.map((s) => s.id) || []);

    const { data: activeDataReq } = await supabase
      .from("process_step_data_requirements")
      .select("step_id, field_key")
      .in("step_id", activeStepIds?.map((s) => s.id) || []);

    // Calculate diffs
    const draftStageKeys = new Set((draftStages || []).map((s) => s.stage_key));
    const activeStageKeys = new Set((activeStages || []).map((s) => s.stage_key));

    const stages_added = [...draftStageKeys].filter((k) => !activeStageKeys.has(k)).length;
    const stages_removed = [...activeStageKeys].filter((k) => !draftStageKeys.has(k)).length;
    const stages_modified = [...draftStageKeys].filter((k) => activeStageKeys.has(k)).length;

    const draftStepKeys = new Set((draftSteps || []).map((s) => s.step_key));
    const activeStepKeys = new Set((activeSteps || []).map((s) => s.step_key));

    const steps_added = [...draftStepKeys].filter((k) => !activeStepKeys.has(k)).length;
    const steps_removed = [...activeStepKeys].filter((k) => !draftStepKeys.has(k)).length;
    const steps_modified = [...draftStepKeys].filter((k) => activeStepKeys.has(k)).length;

    const draftRaciKeys = new Set(
      (draftRaci || []).map((r) => `${r.step_id}:${r.role_key}:${r.raci}`),
    );
    const activeRaciKeys = new Set(
      (activeRaci || []).map((r) => `${r.step_id}:${r.role_key}:${r.raci}`),
    );

    const raci_added = [...draftRaciKeys].filter((k) => !activeRaciKeys.has(k)).length;
    const raci_removed = [...activeRaciKeys].filter((k) => !draftRaciKeys.has(k)).length;

    const draftDataReqKeys = new Set(
      (draftDataReq || []).map((r) => `${r.step_id}:${r.field_key}`),
    );
    const activeDataReqKeys = new Set(
      (activeDataReq || []).map((r) => `${r.step_id}:${r.field_key}`),
    );

    const data_requirements_added = [...draftDataReqKeys].filter(
      (k) => !activeDataReqKeys.has(k),
    ).length;
    const data_requirements_removed = [...activeDataReqKeys].filter(
      (k) => !draftDataReqKeys.has(k),
    ).length;

    return {
      stages_added,
      stages_modified,
      stages_removed,
      steps_added,
      steps_modified,
      steps_removed,
      raci_added,
      raci_removed,
      data_requirements_added,
      data_requirements_removed,
    };
  } catch (error) {
    console.error("Error diffing rulebook versions:", error);
    return null;
  }
}
