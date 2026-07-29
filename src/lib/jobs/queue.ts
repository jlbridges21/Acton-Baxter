import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import type { EnqueueJobInput, ReportJob } from "./types";

type JobRow = {
  id: string;
  report_id: string | null;
  job_type: ReportJob["jobType"];
  status: ReportJob["status"];
  attempts: number;
  available_at: string;
  locked_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type MemoryJobsState = {
  jobs: Map<string, ReportJob>;
};

const globalMemory = globalThis as typeof globalThis & {
  __actonJobsMemory?: MemoryJobsState;
};

function nowIso() {
  return new Date().toISOString();
}

function getMemoryState(): MemoryJobsState {
  if (!globalMemory.__actonJobsMemory) {
    globalMemory.__actonJobsMemory = { jobs: new Map() };
  }
  return globalMemory.__actonJobsMemory;
}

export function usesMemoryJobStore(env = getEnv()): boolean {
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    (env.ENABLE_MOCK_RESEARCH && env.NODE_ENV !== "production") ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function mapRow(row: JobRow): ReportJob {
  return {
    id: row.id,
    reportId: row.report_id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueueJob(input: EnqueueJobInput): Promise<ReportJob> {
  const timestamp = nowIso();
  const job: ReportJob = {
    id: randomUUID(),
    reportId: input.reportId ?? null,
    jobType: input.jobType,
    status: "queued",
    attempts: 0,
    availableAt: input.availableAt ?? timestamp,
    lockedAt: null,
    completedAt: null,
    lastError: null,
    metadata: input.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (usesMemoryJobStore()) {
    getMemoryState().jobs.set(job.id, job);
    return job;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("report_jobs")
    .insert({
      id: job.id,
      report_id: job.reportId,
      job_type: job.jobType,
      status: job.status,
      attempts: job.attempts,
      available_at: job.availableAt,
      metadata_json: job.metadata,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as JobRow);
}

export async function claimJobById(jobId: string): Promise<ReportJob | null> {
  const now = nowIso();

  if (usesMemoryJobStore()) {
    const existing = getMemoryState().jobs.get(jobId);
    if (!existing || existing.status !== "queued") return null;
    const claimed: ReportJob = {
      ...existing,
      status: "running",
      attempts: existing.attempts + 1,
      lockedAt: now,
      updatedAt: now,
    };
    getMemoryState().jobs.set(claimed.id, claimed);
    return claimed;
  }

  const supabase = createServiceClient();
  const { data: existing, error: readError } = await supabase
    .from("report_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("status", "queued")
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) return null;

  const row = existing as JobRow;
  const { data: updated, error } = await supabase
    .from("report_jobs")
    .update({
      status: "running",
      attempts: row.attempts + 1,
      locked_at: now,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!updated) return null;
  return mapRow(updated as JobRow);
}

export async function claimNextJob(options?: {
  jobTypes?: ReportJob["jobType"][];
}): Promise<ReportJob | null> {
  const now = nowIso();

  if (usesMemoryJobStore()) {
    const candidates = [...getMemoryState().jobs.values()]
      .filter((job) => job.status === "queued" && job.availableAt <= now)
      .filter((job) => !options?.jobTypes || options.jobTypes.includes(job.jobType))
      .sort((a, b) => a.availableAt.localeCompare(b.availableAt));
    const next = candidates[0];
    if (!next) return null;
    const claimed: ReportJob = {
      ...next,
      status: "running",
      attempts: next.attempts + 1,
      lockedAt: now,
      updatedAt: now,
    };
    getMemoryState().jobs.set(claimed.id, claimed);
    return claimed;
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("report_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("available_at", now)
    .order("available_at", { ascending: true })
    .limit(1);

  if (options?.jobTypes && options.jobTypes.length > 0) {
    query = query.in("job_type", options.jobTypes);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as JobRow;
  const { data: updated, error: updateError } = await supabase
    .from("report_jobs")
    .update({
      status: "running",
      attempts: row.attempts + 1,
      locked_at: now,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;
  if (!updated) return null;
  return mapRow(updated as JobRow);
}

export async function completeJob(jobId: string): Promise<void> {
  const now = nowIso();
  if (usesMemoryJobStore()) {
    const job = getMemoryState().jobs.get(jobId);
    if (!job) return;
    getMemoryState().jobs.set(jobId, {
      ...job,
      status: "complete",
      completedAt: now,
      updatedAt: now,
      lastError: null,
    });
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("report_jobs")
    .update({
      status: "complete",
      completed_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function failJob(
  jobId: string,
  errorMessage: string,
  options?: { retryAt?: string },
): Promise<void> {
  const now = nowIso();
  if (usesMemoryJobStore()) {
    const job = getMemoryState().jobs.get(jobId);
    if (!job) return;
    if (options?.retryAt) {
      getMemoryState().jobs.set(jobId, {
        ...job,
        status: "queued",
        availableAt: options.retryAt,
        lockedAt: null,
        lastError: errorMessage.slice(0, 500),
        updatedAt: now,
      });
      return;
    }
    getMemoryState().jobs.set(jobId, {
      ...job,
      status: "failed",
      completedAt: now,
      lastError: errorMessage.slice(0, 500),
      updatedAt: now,
    });
    return;
  }

  const supabase = createServiceClient();
  const payload = options?.retryAt
    ? {
        status: "queued" as const,
        available_at: options.retryAt,
        locked_at: null,
        last_error: errorMessage.slice(0, 500),
        updated_at: now,
      }
    : {
        status: "failed" as const,
        completed_at: now,
        last_error: errorMessage.slice(0, 500),
        updated_at: now,
      };

  const { error } = await supabase.from("report_jobs").update(payload).eq("id", jobId);
  if (error) throw error;
}

export async function reclaimStaleRunningJobs(options?: {
  olderThanMs?: number;
  jobTypes?: ReportJob["jobType"][];
}): Promise<{ reclaimed: number }> {
  const olderThanMs = options?.olderThanMs ?? 5 * 60_000;
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const now = nowIso();
  let reclaimed = 0;

  if (usesMemoryJobStore()) {
    for (const job of getMemoryState().jobs.values()) {
      if (job.status !== "running" || !job.lockedAt || job.lockedAt > cutoff) continue;
      if (options?.jobTypes && !options.jobTypes.includes(job.jobType)) continue;
      getMemoryState().jobs.set(job.id, {
        ...job,
        status: "queued",
        availableAt: now,
        lockedAt: null,
        lastError: "Reclaimed stale running job",
        updatedAt: now,
        metadata: {
          ...job.metadata,
          stage: "reclaimed",
          reclaimedAt: now,
        },
      });
      reclaimed += 1;
    }
    return { reclaimed };
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("report_jobs")
    .select("id, job_type, metadata_json")
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .limit(50);
  if (options?.jobTypes?.length) {
    query = query.in("job_type", options.jobTypes);
  }
  const { data, error } = await query;
  if (error) throw error;
  for (const row of (data as Array<{
    id: string;
    job_type: string;
    metadata_json: Record<string, unknown> | null;
  }> | null) ?? []) {
    const metadata = {
      ...(row.metadata_json ?? {}),
      stage: "reclaimed",
      reclaimedAt: now,
    };
    const { error: updateError } = await supabase
      .from("report_jobs")
      .update({
        status: "queued",
        available_at: now,
        locked_at: null,
        last_error: "Reclaimed stale running job",
        updated_at: now,
        metadata_json: metadata,
      })
      .eq("id", row.id)
      .eq("status", "running");
    if (!updateError) reclaimed += 1;
  }
  return { reclaimed };
}

/** Merge safe operational stage metadata onto a job (no message bodies). */
export async function patchJobMetadata(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const now = nowIso();
  if (usesMemoryJobStore()) {
    const job = getMemoryState().jobs.get(jobId);
    if (!job) return;
    getMemoryState().jobs.set(jobId, {
      ...job,
      metadata: { ...job.metadata, ...patch },
      updatedAt: now,
    });
    return;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("report_jobs")
    .select("metadata_json")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return;
  const existing = ((data as { metadata_json: Record<string, unknown> | null }).metadata_json ??
    {}) as Record<string, unknown>;
  await supabase
    .from("report_jobs")
    .update({
      metadata_json: { ...existing, ...patch },
      updated_at: now,
    })
    .eq("id", jobId);
}

export function resetMemoryJobsForTests() {
  globalMemory.__actonJobsMemory = { jobs: new Map() };
}

export function listMemoryJobsForTests(): ReportJob[] {
  return [...getMemoryState().jobs.values()];
}
