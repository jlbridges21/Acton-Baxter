export const JOB_TYPES = [
  "property_research",
  "slack_completion_notification",
  "google_knowledge_sync",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "complete", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type ReportJob = {
  id: string;
  reportId: string | null;
  jobType: JobType;
  status: JobStatus;
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueJobInput = {
  reportId?: string | null;
  jobType: JobType;
  availableAt?: string;
  metadata?: Record<string, unknown>;
};
