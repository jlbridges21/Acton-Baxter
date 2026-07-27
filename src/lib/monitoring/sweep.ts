import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/jobs/queue";
import { buildMonitoringContext } from "./context";
import { getEnabledChecks } from "./checks";
import { upsertFindingCandidate, resolveMissingFindings } from "./findings";
import type { MonitoringRunSummary, TriggerSource, CheckResult } from "./types";

export type RunMonitoringSweepOptions = {
  trigger: TriggerSource;
  force?: boolean;
};

/**
 * Run a monitoring sweep.
 * @param options Trigger source and optional force flag
 * @returns Summary of the run
 */
export async function runMonitoringSweep(
  options: RunMonitoringSweepOptions,
): Promise<MonitoringRunSummary> {
  const supabase = createServiceClient();
  const startTime = Date.now();

  const ctx = await buildMonitoringContext();
  const { settings } = ctx;

  // If monitoring disabled and not forced, skip
  if (!settings.enabled && !options.force) {
    const { data: run } = await supabase
      .from("monitoring_runs")
      .insert({
        status: "skipped",
        trigger_source: options.trigger,
        summary_json: { reason: "monitoring_disabled" },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    return {
      runId: run?.id ?? "unknown",
      status: "skipped",
      triggerSource: options.trigger,
      checksRun: 0,
      recordsEvaluated: 0,
      newFindings: 0,
      refreshedFindings: 0,
      resolvedFindings: 0,
      durationMs: 0,
    };
  }

  const { data: runRecord, error: runError } = await supabase
    .from("monitoring_runs")
    .insert({
      status: "running",
      trigger_source: options.trigger,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (runError || !runRecord) {
    throw new Error(`Failed to create monitoring run: ${runError?.message ?? "unknown"}`);
  }

  const runId = runRecord.id;

  try {
    const checks = getEnabledChecks(ctx);
    const checkResults: CheckResult[] = [];
    let totalRecordsEvaluated = 0;
    let newFindings = 0;
    let refreshedFindings = 0;
    let totalResolvedFindings = 0;

    for (const check of checks) {
      const checkStartTime = Date.now();
      try {
        const candidates = await check.run(ctx);
        const checkDuration = Date.now() - checkStartTime;

        totalRecordsEvaluated += candidates.length;

        const seenDedupeKeys: string[] = [];
        for (const candidate of candidates) {
          const { isNew } = await upsertFindingCandidate(candidate);
          seenDedupeKeys.push(candidate.dedupeKey);
          if (isNew) {
            newFindings += 1;
          } else {
            refreshedFindings += 1;
          }
        }

        const resolvedCount = await resolveMissingFindings(check.key as never, seenDedupeKeys);
        totalResolvedFindings += resolvedCount;

        checkResults.push({
          checkKey: check.key,
          candidates,
          recordsEvaluated: candidates.length,
          durationMs: checkDuration,
        });
      } catch (error) {
        const checkDuration = Date.now() - checkStartTime;
        checkResults.push({
          checkKey: check.key,
          candidates: [],
          recordsEvaluated: 0,
          durationMs: checkDuration,
          error: error instanceof Error ? error.message : "Check failed",
        });
      }
    }

    const durationMs = Date.now() - startTime;

    await supabase
      .from("monitoring_runs")
      .update({
        status: "completed",
        checks_run: checks.length,
        records_evaluated: totalRecordsEvaluated,
        new_findings: newFindings,
        refreshed_findings: refreshedFindings,
        resolved_findings: totalResolvedFindings,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
        summary_json: {
          checkResults: checkResults.map((r) => ({
            checkKey: r.checkKey,
            recordsEvaluated: r.recordsEvaluated,
            durationMs: r.durationMs,
            error: r.error,
          })),
        },
      })
      .eq("id", runId);

    // Enqueue alert delivery if enabled and new/refreshed findings exist
    if (settings.enabled && (newFindings > 0 || refreshedFindings > 0)) {
      await enqueueJob({
        reportId: null,
        jobType: "baxter_alert_delivery",
        metadata: { runId },
      });
    }

    // Enqueue delivery if monitoring is enabled and there are open findings
    if (settings.enabled && !options.force) {
      await enqueueJob({
        reportId: null,
        jobType: "baxter_alert_delivery",
        metadata: { source: "sweep", runId },
      });
    }

    try {
      const { noteMonitoringCapability } = await import("@/lib/baxter-ai/governance/capabilities");
      noteMonitoringCapability(Boolean(settings.enabled));
    } catch {
      // ignore
    }

    return {
      runId,
      status: "completed",
      triggerSource: options.trigger,
      checksRun: checks.length,
      recordsEvaluated: totalRecordsEvaluated,
      newFindings,
      refreshedFindings,
      resolvedFindings: totalResolvedFindings,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Sweep failed";

    await supabase
      .from("monitoring_runs")
      .update({
        status: "failed",
        duration_ms: durationMs,
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      runId,
      status: "failed",
      triggerSource: options.trigger,
      checksRun: 0,
      recordsEvaluated: 0,
      newFindings: 0,
      refreshedFindings: 0,
      resolvedFindings: 0,
      durationMs,
      error: errorMessage,
    };
  }
}
