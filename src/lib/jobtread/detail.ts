/**
 * Live, single-job detail for per-project views (Design Handoff): milestones (task groups)
 * and job files, plus current custom-field values. Read directly from JobTread with a short
 * per-instance cache so switching jobs feels instant without hammering the API.
 *
 * File download URLs are intentionally not returned; the UI links to the job in JobTread,
 * where JobTread's own permissions apply.
 */

import "server-only";

import { getJobTreadConfig, jobTreadJobUrl, newStats, pave } from "./client";
import { listCustomFields } from "./metadata";
import { collectValues, JOB_SYNC_NODES, normalizeJob, type JobNode } from "./sync";

export type Milestone = {
  id: string;
  name: string;
  /** Rolled up from child tasks (calculateGroup). Null for undated checklists. */
  startDate: string | null;
  endDate: string | null;
  completedTasks: number;
  totalTasks: number;
  status: "complete" | "in_progress" | "not_started";
  kind: "schedule" | "checklist";
};

export type JobFile = {
  id: string;
  name: string;
  folder: string | null;
  type: string | null;
  createdAt: string | null;
};

export type JobDetail = {
  job: ReturnType<typeof normalizeJob>;
  milestones: Milestone[];
  files: JobFile[];
  jobtreadUrl: string;
  fetchedAt: string;
  apiRequests: number;
};

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; detail: JobDetail }>();

export function clearJobDetailCache(): void {
  cache.clear();
}

type DetailResponse = {
  job:
    | (JobNode & {
        tasks: {
          nodes: Array<{
            id: string;
            name: string;
            startDate: string | null;
            endDate: string | null;
            completed: number;
            started: number;
            unstarted: number;
          }>;
        };
        files: { nodes: JobFile[] } | null;
      })
    | null;
};

export function milestoneStatus(counts: {
  completed: number;
  started: number;
  unstarted: number;
}): Milestone["status"] {
  const total = counts.completed + counts.started + counts.unstarted;
  if (total > 0 && counts.completed === total) return "complete";
  if (counts.completed > 0 || counts.started > 0) return "in_progress";
  return "not_started";
}

export async function getJobDetail(
  jobId: string,
  options?: { fresh?: boolean },
): Promise<JobDetail | null> {
  if (!/^[A-Za-z0-9]{6,40}$/.test(jobId)) return null;
  const hit = cache.get(jobId);
  if (!options?.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.detail;
  if (!getJobTreadConfig()) return null;

  const stats = newStats();
  const res = await pave<DetailResponse>(
    {
      job: {
        $: { id: jobId },
        ...JOB_SYNC_NODES,
        tasks: {
          $: { size: 100, where: [["isGroup"], "=", true], sortBy: [{ field: "position" }] },
          nodes: {
            id: {},
            name: {},
            startDate: { $: { calculateGroup: true } },
            endDate: { $: { calculateGroup: true } },
            completed: {},
            started: {},
            unstarted: {},
          },
        },
        files: {
          $: { size: 100, sortBy: [{ field: "createdAt", order: "desc" }] },
          nodes: { id: {}, name: {}, folder: {}, type: {}, createdAt: {} },
        },
      },
    },
    { stats },
  );
  if (!res.job) return null;
  const fields = await listCustomFields();
  const allowed = new Set(fields.filter((f) => f.category !== "excluded").map((f) => f.id));
  const detail: JobDetail = {
    job: normalizeJob(res.job, allowed, new Date().toISOString()),
    milestones: res.job.tasks.nodes.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      completedTasks: t.completed ?? 0,
      totalTasks: (t.completed ?? 0) + (t.started ?? 0) + (t.unstarted ?? 0),
      status: milestoneStatus(t),
      kind: t.startDate || t.endDate ? "schedule" : "checklist",
    })),
    files: res.job.files?.nodes ?? [],
    jobtreadUrl: jobTreadJobUrl(jobId),
    fetchedAt: new Date().toISOString(),
    apiRequests: stats.requests,
  };
  cache.set(jobId, { at: Date.now(), detail });
  return detail;
}

export { collectValues };
