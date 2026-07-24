import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import type { SlackErrorCode } from "./errors";

export type SlackReceiptStatus = "received" | "processing" | "completed" | "failed" | "ignored";

export type ClaimSlackEventResult =
  | { claimed: true; status: "received" }
  | { claimed: false; reason: "duplicate"; status: SlackReceiptStatus };

type MemoryReceipt = {
  eventId: string;
  status: SlackReceiptStatus;
  attemptCount: number;
  receivedAt: string;
  processedAt: string | null;
  lastErrorCode: string | null;
  teamId: string | null;
  eventType: string | null;
  eventTs: string | null;
  metadata: Record<string, unknown>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSlackReceipts?: Map<string, MemoryReceipt>;
};

function getMemory(): Map<string, MemoryReceipt> {
  if (!globalMemory.__baxterSlackReceipts) {
    globalMemory.__baxterSlackReceipts = new Map();
  }
  return globalMemory.__baxterSlackReceipts;
}

export function resetSlackReceiptMemoryForTests() {
  globalMemory.__baxterSlackReceipts = new Map();
}

function shouldUseMemoryStore(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const message = (record.message ?? "").toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

/**
 * Claim an event for processing. Duplicate event_ids are not claimed.
 * Failed receipts may be reclaimed once for a controlled retry.
 */
export async function claimSlackEventReceipt(input: {
  eventId: string;
  teamId?: string | null;
  eventType?: string | null;
  eventTs?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ClaimSlackEventResult> {
  if (shouldUseMemoryStore()) {
    const memory = getMemory();
    const existing = memory.get(input.eventId);
    if (existing) {
      if (existing.status === "failed" && existing.attemptCount < 2) {
        existing.status = "processing";
        existing.attemptCount += 1;
        existing.lastErrorCode = null;
        return { claimed: true, status: "received" };
      }
      return { claimed: false, reason: "duplicate", status: existing.status };
    }
    memory.set(input.eventId, {
      eventId: input.eventId,
      status: "processing",
      attemptCount: 1,
      receivedAt: new Date().toISOString(),
      processedAt: null,
      lastErrorCode: null,
      teamId: input.teamId ?? null,
      eventType: input.eventType ?? null,
      eventTs: input.eventTs ?? null,
      metadata: input.metadata ?? {},
    });
    return { claimed: true, status: "received" };
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("slack_event_receipts").insert({
      event_id: input.eventId,
      team_id: input.teamId ?? null,
      event_type: input.eventType ?? null,
      event_ts: input.eventTs ?? null,
      status: "processing",
      attempt_count: 1,
      metadata: input.metadata ?? {},
    });

    if (!error) {
      // Also record in legacy table when present (best-effort).
      void supabase
        .from("slack_processed_events")
        .upsert(
          {
            event_id: input.eventId,
            event_type: input.eventType ?? null,
            team_id: input.teamId ?? null,
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        );
      return { claimed: true, status: "received" };
    }

    if (error.code === "23505") {
      const { data } = await supabase
        .from("slack_event_receipts")
        .select("status, attempt_count")
        .eq("event_id", input.eventId)
        .maybeSingle();

      const status = (data?.status as SlackReceiptStatus | undefined) ?? "completed";
      const attempts = typeof data?.attempt_count === "number" ? data.attempt_count : 1;

      if (status === "failed" && attempts < 2) {
        const { error: updateError } = await supabase
          .from("slack_event_receipts")
          .update({
            status: "processing",
            attempt_count: attempts + 1,
            last_error_code: null,
          })
          .eq("event_id", input.eventId)
          .eq("status", "failed");
        if (!updateError) {
          return { claimed: true, status: "received" };
        }
      }

      return { claimed: false, reason: "duplicate", status };
    }

    if (isMissingTableError(error)) {
      return claimSlackEventReceiptMemoryFallback(input);
    }

    return claimSlackEventReceiptMemoryFallback(input);
  } catch {
    return claimSlackEventReceiptMemoryFallback(input);
  }
}

function claimSlackEventReceiptMemoryFallback(input: {
  eventId: string;
  teamId?: string | null;
  eventType?: string | null;
  eventTs?: string | null;
  metadata?: Record<string, unknown>;
}): ClaimSlackEventResult {
  const memory = getMemory();
  if (memory.has(input.eventId)) {
    return {
      claimed: false,
      reason: "duplicate",
      status: memory.get(input.eventId)!.status,
    };
  }
  memory.set(input.eventId, {
    eventId: input.eventId,
    status: "processing",
    attemptCount: 1,
    receivedAt: new Date().toISOString(),
    processedAt: null,
    lastErrorCode: null,
    teamId: input.teamId ?? null,
    eventType: input.eventType ?? null,
    eventTs: input.eventTs ?? null,
    metadata: input.metadata ?? {},
  });
  return { claimed: true, status: "received" };
}

export async function updateSlackEventReceipt(input: {
  eventId: string;
  status: SlackReceiptStatus;
  errorCode?: SlackErrorCode | string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const processedAt =
    input.status === "completed" || input.status === "failed" || input.status === "ignored"
      ? new Date().toISOString()
      : null;

  if (shouldUseMemoryStore() || getMemory().has(input.eventId)) {
    const existing = getMemory().get(input.eventId);
    if (existing) {
      existing.status = input.status;
      existing.processedAt = processedAt;
      existing.lastErrorCode = input.errorCode ?? existing.lastErrorCode;
      if (input.metadata) existing.metadata = { ...existing.metadata, ...input.metadata };
    }
  }

  if (shouldUseMemoryStore()) return;

  try {
    const supabase = createServiceClient();
    const patch: Record<string, unknown> = {
      status: input.status,
      last_error_code: input.errorCode ?? null,
    };
    if (processedAt) patch.processed_at = processedAt;
    if (input.metadata) {
      patch.metadata = input.metadata;
    }
    await supabase.from("slack_event_receipts").update(patch).eq("event_id", input.eventId);
  } catch {
    // Best-effort; memory already updated when present.
  }
}

export async function getSlackReceiptStats(): Promise<{
  processedLast24h: number;
  duplicatesIgnored: number;
  pendingJobs: number;
  failedJobs: number;
  recentErrorCodes: string[];
  lastValidEventAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
}> {
  const empty = {
    processedLast24h: 0,
    duplicatesIgnored: 0,
    pendingJobs: 0,
    failedJobs: 0,
    recentErrorCodes: [] as string[],
    lastValidEventAt: null as string | null,
    lastCompletedAt: null as string | null,
    lastFailedAt: null as string | null,
  };

  if (shouldUseMemoryStore()) {
    const receipts = Array.from(getMemory().values());
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = receipts.filter((r) => new Date(r.receivedAt).getTime() >= dayAgo);
    return {
      processedLast24h: recent.filter((r) => r.status === "completed").length,
      duplicatesIgnored: 0,
      pendingJobs: receipts.filter((r) => r.status === "processing" || r.status === "received")
        .length,
      failedJobs: receipts.filter((r) => r.status === "failed").length,
      recentErrorCodes: receipts
        .map((r) => r.lastErrorCode)
        .filter((code): code is string => Boolean(code))
        .slice(0, 10),
      lastValidEventAt: receipts[0]?.receivedAt ?? null,
      lastCompletedAt: receipts.find((r) => r.status === "completed")?.processedAt ?? null,
      lastFailedAt: receipts.find((r) => r.status === "failed")?.processedAt ?? null,
    };
  }

  try {
    const supabase = createServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: completed24 }, { data: failedRows }, { data: recentRows }, jobs] =
      await Promise.all([
        supabase
          .from("slack_event_receipts")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed")
          .gte("received_at", since),
        supabase
          .from("slack_event_receipts")
          .select("last_error_code, processed_at")
          .eq("status", "failed")
          .order("received_at", { ascending: false })
          .limit(20),
        supabase
          .from("slack_event_receipts")
          .select("status, received_at, processed_at, last_error_code")
          .order("received_at", { ascending: false })
          .limit(50),
        supabase
          .from("report_jobs")
          .select("status, job_type")
          .eq("job_type", "slack_baxter_reply")
          .in("status", ["queued", "running", "failed"])
          .limit(200),
      ]);

    const jobRows = (jobs.data ?? []) as Array<{ status: string }>;
    const ignored = (recentRows ?? []).filter((r) => r.status === "ignored").length;

    return {
      processedLast24h: completed24 ?? 0,
      duplicatesIgnored: ignored,
      pendingJobs: jobRows.filter((j) => j.status === "queued" || j.status === "running").length,
      failedJobs: jobRows.filter((j) => j.status === "failed").length,
      recentErrorCodes: (failedRows ?? [])
        .map((r) => r.last_error_code as string | null)
        .filter((code): code is string => Boolean(code))
        .slice(0, 10),
      lastValidEventAt: (recentRows?.[0]?.received_at as string | undefined) ?? null,
      lastCompletedAt:
        (recentRows ?? []).find((r) => r.status === "completed")?.processed_at ?? null,
      lastFailedAt: (recentRows ?? []).find((r) => r.status === "failed")?.processed_at ?? null,
    };
  } catch {
    return empty;
  }
}
