/**
 * Admin Receipt Log dashboard — load enriched rows + apply URL filters.
 */

import "server-only";

import { loadProfileDisplayByIds } from "@/lib/auth/load-profile-display";
import type { ReceiptLogFiltersState } from "./log-filter-url";
import {
  queryReceiptLogRows,
  resolveReceiptLogRange,
  type ReceiptLogQueryResult,
  type ReceiptLogRow,
} from "./log-query";
import { createReceiptPhotoSignedUrlMap } from "./storage";
import { getExpenseJob, listAllReceipts, listExpenseJobs } from "./store";

export async function loadReceiptLogCorpus(options?: {
  /** When true, skip signed URL generation (CSV export). */
  skipSignedUrls?: boolean;
}): Promise<ReceiptLogRow[]> {
  const receipts = await listAllReceipts();
  const jobs = await listExpenseJobs({ includeInactive: true });
  const jobLabelById = new Map(jobs.map((j) => [j.id, j.label]));
  // Fill any missing job labels individually (defensive)
  for (const receipt of receipts) {
    if (receipt.jobId && !jobLabelById.has(receipt.jobId)) {
      const job = await getExpenseJob(receipt.jobId);
      if (job) jobLabelById.set(job.id, job.label);
    }
  }

  const displays = await loadProfileDisplayByIds(receipts.map((r) => r.submittedBy));
  const photoPaths = receipts.map((r) => r.photoStoragePath).filter((p): p is string => Boolean(p));
  const signedMap = options?.skipSignedUrls
    ? new Map<string, string>()
    : await createReceiptPhotoSignedUrlMap(photoPaths, 600);

  return receipts.map((r) => {
    const isCustomJob = Boolean(r.customJobLabel && !r.jobId);
    const jobLabel = isCustomJob
      ? (r.customJobLabel ?? "Custom")
      : (jobLabelById.get(r.jobId ?? "") ?? "Unknown job");
    const display = displays.get(r.submittedBy);
    return {
      id: r.id,
      submittedBy: r.submittedBy,
      submitterName: display?.displayName ?? `User ${r.submittedBy.slice(0, 8)}`,
      submitterEmail: display?.email ?? null,
      submitterLabel: display?.label ?? `User ${r.submittedBy.slice(0, 8)}`,
      jobId: r.jobId,
      customJobLabel: r.customJobLabel,
      jobLabel,
      isCustomJob,
      amountCents: r.amountCents,
      vendor: r.vendor,
      purchasedOn: r.purchasedOn,
      items: r.items,
      description: r.description,
      photoStoragePath: r.photoStoragePath,
      photoSignedUrl: r.photoStoragePath ? (signedMap.get(r.photoStoragePath) ?? null) : null,
      photoPermalink: `/receipts/${r.id}/photo`,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export async function getReceiptLogDashboard(input: {
  filters: ReceiptLogFiltersState;
  limit?: number;
  offset?: number;
  skipSignedUrls?: boolean;
}): Promise<ReceiptLogQueryResult> {
  const corpus = await loadReceiptLogCorpus({ skipSignedUrls: input.skipSignedUrls });
  return queryReceiptLogRows(corpus, {
    filters: input.filters,
    range: resolveReceiptLogRange(input.filters),
    limit: input.limit,
    offset: input.offset,
  });
}
