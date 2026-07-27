import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import type { CheckConfig, MonitoringSettings } from "./types";

function mapSettingsRow(data: Record<string, unknown>): MonitoringSettings {
  return {
    id: data.id as string,
    enabled: Boolean(data.enabled),
    pilot_slack_channel_id: (data.pilot_slack_channel_id as string | null) ?? null,
    pilot_slack_channel_name: (data.pilot_slack_channel_name as string | null) ?? null,
    timezone: (data.timezone as string) || "America/Los_Angeles",
    quiet_hours_start: (data.quiet_hours_start as string | null) ?? null,
    quiet_hours_end: (data.quiet_hours_end as string | null) ?? null,
    delivery_mode: (data.delivery_mode as MonitoringSettings["delivery_mode"]) || "digest",
    escalation_window_minutes: Number(data.escalation_window_minutes) || 240,
    default_stale_days: Number(data.default_stale_days) || 3,
    monitored_pipeline_ids: (data.monitored_pipeline_ids as string[]) || [],
    check_configs: (data.check_configs as Record<string, CheckConfig>) || {},
    stage_stale_overrides: (data.stage_stale_overrides as Record<string, number>) || {},
    updated_by: (data.updated_by as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

/**
 * Get monitoring settings (singleton row).
 */
export async function getMonitoringSettings(): Promise<MonitoringSettings> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("monitoring_settings")
    .select("*")
    .eq("id", "default")
    .single();

  if (error) {
    throw new Error(`Failed to load monitoring settings: ${error.message}`);
  }

  if (!data) {
    throw new Error("Monitoring settings not found");
  }

  return mapSettingsRow(data as Record<string, unknown>);
}

/**
 * Update monitoring settings.
 */
export async function updateMonitoringSettings(
  patch: Partial<
    Pick<
      MonitoringSettings,
      | "enabled"
      | "pilot_slack_channel_id"
      | "pilot_slack_channel_name"
      | "timezone"
      | "quiet_hours_start"
      | "quiet_hours_end"
      | "delivery_mode"
      | "escalation_window_minutes"
      | "default_stale_days"
      | "monitored_pipeline_ids"
      | "check_configs"
      | "stage_stale_overrides"
    >
  >,
  actorUserId: string,
): Promise<MonitoringSettings> {
  const supabase = createServiceClient();

  const updateData: Record<string, unknown> = {
    ...patch,
    updated_by: actorUserId,
  };

  const { data, error } = await supabase
    .from("monitoring_settings")
    .update(updateData)
    .eq("id", "default")
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update monitoring settings: ${error.message}`);
  }

  const mapped = mapSettingsRow(data as Record<string, unknown>);
  try {
    const { noteMonitoringCapability } = await import("@/lib/baxter-ai/governance/capabilities");
    const hasOperational = Object.values(mapped.check_configs || {}).some(
      (c) => c && typeof c === "object" && (c as { enabled?: boolean }).enabled === true,
    );
    noteMonitoringCapability(Boolean(mapped.enabled && hasOperational));
  } catch {
    // ignore capability cache failures
  }
  return mapped;
}

/**
 * Check if monitoring is enabled.
 */
export async function isMonitoringEnabled(): Promise<boolean> {
  const settings = await getMonitoringSettings();
  return settings.enabled;
}
