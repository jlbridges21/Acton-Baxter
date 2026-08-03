import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth/session";

function ok(payload: Record<string, unknown>) {
  return NextResponse.json({ success: true, ...payload });
}

function clientErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed";
}

function isSchemaMissingError(error: unknown): boolean {
  const msg = clientErrorMessage(error).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    msg.includes("pgrst") ||
    msg.includes("relation")
  );
}

function toClientSettings(settings: {
  enabled: boolean;
  pilot_slack_channel_id: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  delivery_mode: string;
  escalation_window_minutes: number;
  sweep_interval_minutes: number;
  default_stale_days: number;
  monitored_pipeline_ids: string[];
  check_configs: Record<string, Record<string, unknown>>;
}) {
  return {
    enabled: settings.enabled,
    slack_channel_id: settings.pilot_slack_channel_id,
    quiet_hours_start: settings.quiet_hours_start,
    quiet_hours_end: settings.quiet_hours_end,
    timezone: settings.timezone,
    delivery_mode: settings.delivery_mode,
    escalation_minutes: settings.escalation_window_minutes,
    sweep_interval_minutes: settings.sweep_interval_minutes,
    stale_opportunity_days: settings.default_stale_days,
    monitored_pipelines: settings.monitored_pipeline_ids,
    check_configs: settings.check_configs,
  };
}

function fromClientSettingsPatch(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if ("enabled" in patch) out.enabled = patch.enabled;
  if ("slack_channel_id" in patch) out.pilot_slack_channel_id = patch.slack_channel_id;
  if ("pilot_slack_channel_id" in patch) out.pilot_slack_channel_id = patch.pilot_slack_channel_id;
  if ("quiet_hours_start" in patch) out.quiet_hours_start = patch.quiet_hours_start;
  if ("quiet_hours_end" in patch) out.quiet_hours_end = patch.quiet_hours_end;
  if ("timezone" in patch) out.timezone = patch.timezone;
  if ("delivery_mode" in patch) {
    const mode = patch.delivery_mode;
    out.delivery_mode = mode === "none" ? "digest" : mode;
  }
  if ("escalation_minutes" in patch) out.escalation_window_minutes = patch.escalation_minutes;
  if ("escalation_window_minutes" in patch) {
    out.escalation_window_minutes = patch.escalation_window_minutes;
  }
  if ("sweep_interval_minutes" in patch) {
    out.sweep_interval_minutes = patch.sweep_interval_minutes;
  }
  if ("stale_opportunity_days" in patch) out.default_stale_days = patch.stale_opportunity_days;
  if ("default_stale_days" in patch) out.default_stale_days = patch.default_stale_days;
  if ("monitored_pipelines" in patch) out.monitored_pipeline_ids = patch.monitored_pipelines;
  if ("monitored_pipeline_ids" in patch) out.monitored_pipeline_ids = patch.monitored_pipeline_ids;
  if ("check_configs" in patch) out.check_configs = patch.check_configs;
  if ("stage_stale_overrides" in patch) out.stage_stale_overrides = patch.stage_stale_overrides;
  if ("pilot_slack_channel_name" in patch) {
    out.pilot_slack_channel_name = patch.pilot_slack_channel_name;
  }
  return out;
}

function toClientFinding(finding: Record<string, unknown>) {
  const status = finding.status === "dismissed_false_positive" ? "false_positive" : finding.status;
  return {
    id: finding.id,
    check_key: finding.check_key,
    status,
    severity: finding.severity,
    title: finding.title,
    description:
      (finding.recommendation as string | null) ||
      (typeof finding.evidence_json === "object" && finding.evidence_json
        ? JSON.stringify(finding.evidence_json).slice(0, 200)
        : ""),
    context: (finding.evidence_json as Record<string, unknown>) || {},
    detected_at: finding.detected_at,
    last_detected_at: finding.last_detected_at,
    acknowledged_at: finding.acknowledged_at,
    resolved_at: finding.resolved_at,
    notes: null,
    opportunity_id: finding.opportunity_id,
    contact_id: finding.contact_id,
    responsible_role_key: finding.responsible_role_key,
  };
}

function toClientRun(run: Record<string, unknown>) {
  return {
    id: run.id,
    started_at: run.started_at,
    completed_at: run.completed_at,
    status: run.status,
    findings_detected: run.new_findings ?? 0,
    checks_run: run.checks_run ?? 0,
    error_message: run.error_message,
    records_evaluated: run.records_evaluated,
    duration_ms: run.duration_ms,
    summary_json: run.summary_json,
  };
}

export async function GET(_request: Request) {
  try {
    await requireAdmin();
    const { getMonitoringDashboardSummary, getMonitoringSettings } =
      await import("@/lib/monitoring");

    let settings;
    try {
      settings = await getMonitoringSettings();
    } catch (error) {
      if (isSchemaMissingError(error)) {
        return ok({
          needsSetup: true,
          setupMessage:
            "Process Monitoring database setup is incomplete. Apply migrations 023_baxter_monitoring.sql and 024_monitoring_partial_runs.sql in Supabase.",
          enabled: false,
          lastSweepAt: null,
          openFindings: 0,
          acknowledgedFindings: 0,
          resolvedToday: 0,
          falsePositiveRate: 0,
          connectorStatus: "unknown",
          rulebookStatus: "unknown",
        });
      }
      throw error;
    }

    const summary = await getMonitoringDashboardSummary();
    let connectorStatus = "unknown";
    let rulebookStatus = "unknown";
    try {
      const { evaluateGhlHealth } = await import("@/lib/connectors/ghl/health");
      const health = await evaluateGhlHealth();
      connectorStatus =
        health.overall === "connected" || health.overall === "healthy"
          ? "healthy"
          : health.overall === "connected_limited"
            ? "warning"
            : "unavailable";
    } catch {
      connectorStatus = "unavailable";
    }
    try {
      const { getActiveRulebook } = await import("@/lib/rulebook");
      const active = await getActiveRulebook();
      rulebookStatus = active ? `v${active.version_number} active` : "no active rulebook";
    } catch {
      rulebookStatus = "unavailable";
    }

    return ok({
      needsSetup: false,
      enabled: settings.enabled,
      lastSweepAt: summary.lastRun?.completed_at ?? summary.lastRun?.started_at ?? null,
      lastRunStatus: summary.lastRun?.status ?? null,
      openFindings: summary.openCount + summary.alertedCount,
      acknowledgedFindings: summary.acknowledgedCount,
      resolvedToday: summary.resolvedTodayCount,
      falsePositiveRate: summary.falsePositiveRate,
      connectorStatus,
      rulebookStatus,
      openCount: summary.openCount,
      alertedCount: summary.alertedCount,
      lastRun: summary.lastRun
        ? toClientRun(summary.lastRun as unknown as Record<string, unknown>)
        : null,
    });
  } catch (error) {
    console.error("[monitoring] GET summary failed", {
      message: clientErrorMessage(error),
    });
    if (isSchemaMissingError(error)) {
      return ok({
        needsSetup: true,
        setupMessage:
          "Process Monitoring database setup is incomplete. Apply migrations 022–024 in Supabase.",
        enabled: false,
        lastSweepAt: null,
        openFindings: 0,
        acknowledgedFindings: 0,
        resolvedToday: 0,
        falsePositiveRate: 0,
        connectorStatus: "unknown",
        rulebookStatus: "unknown",
      });
    }
    return jsonError(error, "GET /api/admin/baxter/monitoring");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = await request.json();

    const action = body.action as string | undefined;

    if (!action) {
      throw new AppError("Missing action", { statusCode: 400 });
    }

    if (action === "get_settings") {
      const { getMonitoringSettings } = await import("@/lib/monitoring");
      const settings = await getMonitoringSettings();
      return ok({ settings: toClientSettings(settings) });
    }

    if (action === "update_settings") {
      const { updateMonitoringSettings } = await import("@/lib/monitoring");
      const patch = body.patch as Record<string, unknown>;
      if (!patch) {
        throw new AppError("Missing patch", { statusCode: 400 });
      }

      const settings = await updateMonitoringSettings(fromClientSettingsPatch(patch), session.id);
      return ok({ settings: toClientSettings(settings) });
    }

    if (action === "list_findings") {
      const { listFindings } = await import("@/lib/monitoring");
      const filters = body.filters as Record<string, unknown> | undefined;
      const findings = await listFindings(filters as never);
      return ok({
        findings: findings.map((f) => toClientFinding(f as unknown as Record<string, unknown>)),
      });
    }

    if (action === "get_finding") {
      const { getFinding } = await import("@/lib/monitoring");
      const id = body.id as string | undefined;
      if (!id) {
        throw new AppError("Missing finding id", { statusCode: 400 });
      }
      const finding = await getFinding(id);
      return ok({
        finding: finding ? toClientFinding(finding as unknown as Record<string, unknown>) : null,
      });
    }

    if (action === "list_runs") {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const supabase = createServiceClient();
      const limit = typeof body.limit === "number" ? body.limit : 50;

      const { data: runs, error } = await supabase
        .from("monitoring_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to list runs: ${error.message}`);
      }

      return ok({
        runs: (runs || []).map((r) => toClientRun(r as Record<string, unknown>)),
      });
    }

    if (action === "run_sweep") {
      const { runMonitoringSweep } = await import("@/lib/monitoring");
      const force = body.force === true;
      const summary = await runMonitoringSweep({
        trigger: "manual",
        force,
      });
      return ok({ summary });
    }

    if (action === "list_mappings") {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const supabase = createServiceClient();

      const { data: mappings, error } = await supabase
        .from("ghl_rulebook_mappings")
        .select("*")
        .order("ghl_pipeline_name", { ascending: true });

      if (error) {
        throw new Error(`Failed to list mappings: ${error.message}`);
      }

      return ok({ mappings: mappings || [] });
    }

    if (action === "update_check_config") {
      const { updateMonitoringSettings, getMonitoringSettings } = await import("@/lib/monitoring");
      const checkKey = body.checkKey as string | undefined;
      const config = body.config as Record<string, unknown> | undefined;

      if (!checkKey) {
        throw new AppError("Missing checkKey", { statusCode: 400 });
      }

      const currentSettings = await getMonitoringSettings();
      const checkConfigs = { ...currentSettings.check_configs };
      checkConfigs[checkKey] = config || {};

      const settings = await updateMonitoringSettings({ check_configs: checkConfigs }, session.id);
      return ok({ settings: toClientSettings(settings) });
    }

    throw new AppError(`Unknown action: ${action}`, { statusCode: 400 });
  } catch (error) {
    console.error("[monitoring] POST failed", {
      message: clientErrorMessage(error),
    });
    if (isSchemaMissingError(error)) {
      return NextResponse.json(
        {
          success: false,
          needsSetup: true,
          error:
            "Process Monitoring isn't ready yet. Apply migrations 023 and 024 in Supabase, then refresh.",
        },
        { status: 503 },
      );
    }
    return jsonError(error, "POST /api/admin/baxter/monitoring");
  }
}
