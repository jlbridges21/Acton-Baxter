import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { getActiveRulebook } from "@/lib/rulebook/versions";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import type { MonitoringContext, GhlRulebookMapping } from "./types";
import { getMonitoringSettings } from "./settings";

/**
 * Build monitoring context for check execution.
 */
export async function buildMonitoringContext(): Promise<MonitoringContext> {
  const settings = await getMonitoringSettings();
  const activeRulebook = await getActiveRulebook();
  const mappings = await loadGhlRulebookMappings();
  const ghlConfigured = isGhlConfigured();

  return {
    settings,
    activeRulebook: activeRulebook
      ? {
          id: activeRulebook.id,
          version_number: activeRulebook.version_number,
        }
      : null,
    mappings,
    ghlConfigured,
  };
}

/**
 * Load GHL rulebook mappings.
 */
async function loadGhlRulebookMappings(): Promise<GhlRulebookMapping[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("ghl_rulebook_mappings")
    .select("*")
    .eq("enabled", true);

  if (error) {
    throw new Error(`Failed to load GHL rulebook mappings: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    ghl_pipeline_id: row.ghl_pipeline_id,
    ghl_pipeline_name: row.ghl_pipeline_name,
    ghl_stage_id: row.ghl_stage_id,
    ghl_stage_name: row.ghl_stage_name,
    rulebook_stage_key: row.rulebook_stage_key,
    rulebook_step_key: row.rulebook_step_key,
    enabled: row.enabled,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}
