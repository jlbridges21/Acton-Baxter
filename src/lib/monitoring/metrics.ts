import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { listFindings, computeFalsePositiveRate } from "./findings";
import type { MonitoringRun } from "./types";

export type MonitoringDashboardSummary = {
  openCount: number;
  alertedCount: number;
  acknowledgedCount: number;
  resolvedTodayCount: number;
  falsePositiveRate: number;
  lastRun: MonitoringRun | null;
};

/**
 * Get dashboard summary metrics.
 */
export async function getMonitoringDashboardSummary(): Promise<MonitoringDashboardSummary> {
  const supabase = createServiceClient();

  const [openFindings, alertedFindings, acknowledgedFindings] = await Promise.all([
    listFindings({ status: "open", limit: 1000 }),
    listFindings({ status: "alerted", limit: 1000 }),
    listFindings({ status: "acknowledged", limit: 1000 }),
  ]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const { data: resolvedToday } = await supabase
    .from("monitoring_findings")
    .select("id")
    .eq("status", "resolved")
    .gte("resolved_at", todayIso);

  const resolvedTodayCount = resolvedToday?.length ?? 0;

  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const falsePositiveRate = await computeFalsePositiveRate(last30Days);

  const { data: lastRunData } = await supabase
    .from("monitoring_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  const lastRun = lastRunData
    ? {
        id: lastRunData.id,
        status: lastRunData.status,
        trigger_source: lastRunData.trigger_source,
        checks_run: lastRunData.checks_run,
        records_evaluated: lastRunData.records_evaluated,
        new_findings: lastRunData.new_findings,
        refreshed_findings: lastRunData.refreshed_findings,
        resolved_findings: lastRunData.resolved_findings,
        duration_ms: lastRunData.duration_ms,
        error_message: lastRunData.error_message,
        summary_json: lastRunData.summary_json,
        started_at: lastRunData.started_at,
        completed_at: lastRunData.completed_at,
        created_at: lastRunData.created_at,
      }
    : null;

  return {
    openCount: openFindings.length,
    alertedCount: alertedFindings.length,
    acknowledgedCount: acknowledgedFindings.length,
    resolvedTodayCount,
    falsePositiveRate,
    lastRun,
  };
}
