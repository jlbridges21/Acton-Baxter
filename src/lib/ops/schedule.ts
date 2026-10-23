/**
 * Enqueue the Sam Operations sweep from the existing cron (every ~15 minutes). The sweep advances
 * workflows, retries approved actions, and raises deduplicated reminders. Missing tables (migration
 * not yet applied) make this a no-op instead of breaking other jobs.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";

const INTERVAL_MS = 15 * 60_000;
const MARKER = "_sweep";

export async function maybeEnqueueSamOperationsSweep(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  const row = await selectOne<{ key: string; last_tested_at: string | null }>(
    "ops_integration_settings",
    { filters: [eq("key", MARKER)] },
  );
  if (row?.last_tested_at && Date.now() - Date.parse(row.last_tested_at) < INTERVAL_MS)
    return { enqueued: false, reason: "Interval not elapsed" };
  const now = new Date().toISOString();
  if (row)
    await agentDb().update("ops_integration_settings", [eq("key", MARKER)], {
      last_tested_at: now,
    });
  else
    await agentDb().insert("ops_integration_settings", {
      key: MARKER,
      config: {},
      last_tested_at: now,
      last_status: "sweep",
    });
  const { enqueueJob } = await import("@/lib/jobs/queue");
  await enqueueJob({ jobType: "sam_operations_sweep", metadata: { source: "scheduled" } });
  return { enqueued: true, reason: "enqueued" };
}

export async function runSamOperationsSweep(): Promise<Record<string, number>> {
  const { sweepOperations } = await import("./engine");
  return sweepOperations();
}
