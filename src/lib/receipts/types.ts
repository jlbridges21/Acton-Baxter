/**
 * Receipt Log — types.
 */

export const EXPENSE_JOB_SOURCES = ["project", "custom"] as const;
export type ExpenseJobSource = (typeof EXPENSE_JOB_SOURCES)[number];

export const RECEIPT_PHOTOS_BUCKET = "receipt-photos";

export type ExpenseJob = {
  id: string;
  label: string;
  projectNumber: string | null;
  source: ExpenseJobSource;
  isActive: boolean;
  sortOrder: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Receipt = {
  id: string;
  submittedBy: string;
  jobId: string;
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
  jobId: string;
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
