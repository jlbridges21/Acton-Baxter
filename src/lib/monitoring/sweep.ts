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
 * Whether a completed sweep should enqueue baxter_alert_delivery.
 * Covers both new/refreshed findings and escalation-only scheduled sweeps,
 * without double-enqueueing.
 */
export function shouldEnqueueAlertDeliveryAfterSweep(input: {
  enabled: boolean;
  force?: boolean;
  newFindings: number;
  refreshedFindings: number;
}): boolean {
  const hasFindings = input.newFindings > 0 || input.refreshedFindings > 0;
  return input.enabled && (!input.force || hasFindings);
}

/**
 * Run a monitoring sweep.
 * Incomplete GHL coverage → run status `partial` (never "all clear").
 */
export async function runMonitoringSweep(
  options: RunMonitoringSweepOptions,
): Promise<MonitoringRunSummary> {
  const supabase = createServiceClient();
  const startTime = Date.now();

  const ctx = await buildMonitoringContext();
  const { settings } = ctx;

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
    let anyIncomplete = false;
    let anyCheckError = false;

    for (const check of checks) {
      const checkStartTime = Date.now();
      try {
        const result = await check.run(ctx);
        const checkDuration = Date.now() - checkStartTime;
        const candidates = result.candidates;
        const records = result.recordsEvaluated ?? candidates.length;
        totalRecordsEvaluated += records;

        if (result.incomplete) {
          anyIncomplete = true;
        }

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

        // Do not auto-resolve when coverage was incomplete — would falsely clear findings.
        let resolvedCount = 0;
        if (!result.incomplete) {
          resolvedCount = await resolveMissingFindings(check.key as never, seenDedupeKeys);
          totalResolvedFindings += resolvedCount;
        }

        checkResults.push({
          checkKey: check.key,
          candidates,
          recordsEvaluated: records,
          durationMs: checkDuration,
          incomplete: result.incomplete,
          incompleteReason: result.incompleteReason,
        });
      } catch (error) {
        anyCheckError = true;
        const checkDuration = Date.now() - checkStartTime;
        checkResults.push({
          checkKey: check.key,
          candidates: [],
          recordsEvaluated: 0,
          durationMs: checkDuration,
          error: error instanceof Error ? error.message : "Check failed",
          incomplete: true,
          incompleteReason: error instanceof Error ? error.message : "Check failed",
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const finalStatus = anyCheckError || anyIncomplete ? "partial" : "completed";

    await supabase
      .from("monitoring_runs")
      .update({
        status: finalStatus,
        checks_run: checks.length,
        records_evaluated: totalRecordsEvaluated,
        new_findings: newFindings,
        refreshed_findings: refreshedFindings,
        resolved_findings: totalResolvedFindings,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
        summary_json: {
          dataCoverage: anyIncomplete || anyCheckError ? "partial" : "complete",
          checkResults: checkResults.map((r) => ({
            checkKey: r.checkKey,
            recordsEvaluated: r.recordsEvaluated,
            durationMs: r.durationMs,
            error: r.error,
            incomplete: r.incomplete,
            incompleteReason: r.incompleteReason,
            findingCount: r.candidates.length,
          })),
        },
      })
      .eq("id", runId);

    // Single enqueue: deliver new/refreshed findings, and on normal (non-force)
    // sweeps also run so escalations can fire even when nothing new was detected.
    if (
      shouldEnqueueAlertDeliveryAfterSweep({
        enabled: settings.enabled,
        force: options.force,
        newFindings,
        refreshedFindings,
      })
    ) {
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
      status: finalStatus,
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
