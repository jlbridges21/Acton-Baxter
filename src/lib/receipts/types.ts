/**
 * Receipt Log — types.
 */

export const EXPENSE_JOB_SOURCES = ["project", "custom"] as const;
export type ExpenseJobSource = (typeof EXPENSE_JOB_SOURCES)[number];

/** Master Project Log column J, copied onto project rows. Custom rows ignore it. */
export const EXPENSE_JOB_PROJECT_STATUSES = ["open", "closed", "unknown"] as const;
export type ExpenseJobProjectStatus = (typeof EXPENSE_JOB_PROJECT_STATUSES)[number];

export const RECEIPT_PHOTOS_BUCKET = "receipt-photos";

export type ExpenseJob = {
  id: string;
  label: string;
  projectNumber: string | null;
  source: ExpenseJobSource;
  projectStatus: ExpenseJobProjectStatus;
  isActive: boolean;
  sortOrder: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseJobSelectionOptions = {
  /**
   * Receipts and Inventory may use Closed projects; Site Inspections may not.
   * Unknown-status projects and hidden jobs are never selectable.
   */
  allowClosed: boolean;
};

/** Whether a picker may offer this job: active, and custom, Open, or (when allowed) Closed. */
export function isSelectableExpenseJob(
  job: Pick<ExpenseJob, "isActive" | "source" | "projectStatus">,
  options: ExpenseJobSelectionOptions,
): boolean {
  if (!job.isActive) return false;
  if (job.source === "custom") return true;
  if (job.projectStatus === "open") return true;
  return options.allowClosed && job.projectStatus === "closed";
}

/** Label for a linked job that is no longer offered in pickers. */
export function expenseJobDisplayLabel(
  job: Pick<ExpenseJob, "label" | "source" | "projectStatus">,
): string {
  return job.source === "project" && job.projectStatus === "closed"
    ? `${job.label} (Closed)`
    : job.label;
}

/**
 * Split a full job list into picker options plus display labels for the
 * non-pickable jobs that existing records still link to.
 */
export function splitPickerJobs(
  allJobs: ExpenseJob[],
  linkedJobIds: Iterable<string | null | undefined>,
  options: ExpenseJobSelectionOptions,
): { pickable: ExpenseJob[]; linkedLabels: Record<string, string> } {
  const pickable = allJobs.filter((job) => isSelectableExpenseJob(job, options));
  const pickableIds = new Set(pickable.map((job) => job.id));
  const byId = new Map(allJobs.map((job) => [job.id, job]));
  const linkedLabels: Record<string, string> = {};
  for (const id of linkedJobIds) {
    if (!id || pickableIds.has(id)) continue;
    const job = byId.get(id);
    if (job) linkedLabels[id] = expenseJobDisplayLabel(job);
  }
  return { pickable, linkedLabels };
}

export type Receipt = {
  id: string;
  submittedBy: string;
  /** Null when customJobLabel is set (xor). */
  jobId: string | null;
  /** One-off label for this receipt only — never an expense_jobs row. */
  customJobLabel: string | null;
  amountCents: number;
  vendor: string;
  purchasedOn: string;
  items: string | null;
  description: string | null;
  photoStoragePath: string | null;
  extraction: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ReceiptCreateInput = {
  jobId?: string | null;
  customJobLabel?: string | null;
  amountCents: number;
  vendor: string;
  purchasedOn: string;
  items?: string | null;
  description?: string | null;
  photoStoragePath?: string | null;
  extraction?: Record<string, unknown> | null;
  submittedBy: string;
};

export type ExpenseJobCreateCustomInput = {
  label: string;
  sortOrder?: number;
  isActive?: boolean;
  createdBy: string;
};

export type ExpenseJobUpdateInput = {
  id: string;
  label?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy: string;
};
