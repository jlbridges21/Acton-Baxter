import "server-only";

/**
 * GHL pipeline/stage → Rulebook stage/step mappings.
 */

import { createServiceClient } from "@/lib/supabase/admin";

export type GhlRulebookMapping = {
  id: string;
  ghlPipelineId: string;
  ghlPipelineName: string | null;
  ghlStageId: string;
  ghlStageName: string | null;
  rulebookStageKey: string;
  rulebookStepKey: string | null;
  enabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * List all GHL → Rulebook mappings.
 */
export async function listMappings(options?: {
  enabledOnly?: boolean;
}): Promise<GhlRulebookMapping[]> {
  const supabase = createServiceClient();

  let query = supabase
    .from("ghl_rulebook_mappings")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.enabledOnly) {
    query = query.eq("enabled", true);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []).map((row) => ({
    id: row.id,
    ghlPipelineId: row.ghl_pipeline_id,
    ghlPipelineName: row.ghl_pipeline_name,
    ghlStageId: row.ghl_stage_id,
    ghlStageName: row.ghl_stage_name,
    rulebookStageKey: row.rulebook_stage_key,
    rulebookStepKey: row.rulebook_step_key,
    enabled: row.enabled,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Upsert a GHL → Rulebook mapping.
 */
export async function upsertMapping(
  mapping: {
    ghlPipelineId: string;
    ghlPipelineName?: string;
    ghlStageId: string;
    ghlStageName?: string;
    rulebookStageKey: string;
    rulebookStepKey?: string;
    enabled?: boolean;
  },
  actorUserId: string,
): Promise<{ id: string }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("ghl_rulebook_mappings")
    .upsert(
      {
        ghl_pipeline_id: mapping.ghlPipelineId,
        ghl_pipeline_name: mapping.ghlPipelineName || null,
        ghl_stage_id: mapping.ghlStageId,
        ghl_stage_name: mapping.ghlStageName || null,
        rulebook_stage_key: mapping.rulebookStageKey,
        rulebook_step_key: mapping.rulebookStepKey || null,
        enabled: mapping.enabled !== undefined ? mapping.enabled : true,
        updated_by: actorUserId,
      },
      {
        onConflict: "ghl_pipeline_id,ghl_stage_id",
      },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw error || new Error("Failed to upsert mapping");
  }

  return { id: data.id };
}

/**
 * Delete a GHL → Rulebook mapping.
 */
export async function deleteMapping(mappingId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("ghl_rulebook_mappings").delete().eq("id", mappingId);

  if (error) {
    throw error;
  }
}
