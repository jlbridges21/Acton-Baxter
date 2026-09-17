/**
 * Receipt Log dashboard loaders — admin (all users) and personal (owner-scoped).
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
import { getExpenseJob, listAllReceipts, listExpenseJobs, listReceiptsForUser } from "./store";
import type { Receipt } from "./types";

async function enrichReceiptsToLogRows(
  receipts: Receipt[],
  options?: { skipSignedUrls?: boolean; skipSubmitterLookup?: boolean },
): Promise<ReceiptLogRow[]> {
  const jobs = await listExpenseJobs({ includeInactive: true });
  const jobLabelById = new Map(jobs.map((j) => [j.id, j.label]));
  for (const receipt of receipts) {
    if (receipt.jobId && !jobLabelById.has(receipt.jobId)) {
      const job = await getExpenseJob(receipt.jobId);
      if (job) jobLabelById.set(job.id, job.label);
    }
  }

  const displays = options?.skipSubmitterLookup
    ? new Map()
    : await loadProfileDisplayByIds(receipts.map((r) => r.submittedBy));
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

export async function loadReceiptLogCorpus(options?: {
  skipSignedUrls?: boolean;
}): Promise<ReceiptLogRow[]> {
  const receipts = await listAllReceipts();
  return enrichReceiptsToLogRows(receipts, options);
}

/**
 * Owner-scoped corpus. Always filters by `ownerUserId` in the data layer —
 * never trusts client-supplied user filter params.
 */
export async function loadMyReceiptLogCorpus(
  ownerUserId: string,
  options?: { skipSignedUrls?: boolean },
): Promise<ReceiptLogRow[]> {
  if (!ownerUserId.trim()) return [];
  const receipts = await listReceiptsForUser(ownerUserId);
  // Defense in depth: drop any row that somehow isn't owned by the viewer.
  const owned = receipts.filter((r) => r.submittedBy === ownerUserId && !r.deletedAt);
  return enrichReceiptsToLogRows(owned, {
    ...options,
    skipSubmitterLookup: true,
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

/**
 * Personal Receipt Log dashboard. Ignores/strips any `userIds` filter so a
 * crafted URL cannot widen the result set beyond the signed-in owner.
 */
export async function getMyReceiptLogDashboard(input: {
  ownerUserId: string;
  filters: ReceiptLogFiltersState;
  limit?: number;
  offset?: number;
  skipSignedUrls?: boolean;
}): Promise<ReceiptLogQueryResult> {
  const corpus = await loadMyReceiptLogCorpus(input.ownerUserId, {
    skipSignedUrls: input.skipSignedUrls,
  });
  const filters: ReceiptLogFiltersState = {
    ...input.filters,
    userIds: [],
  };
  return queryReceiptLogRows(corpus, {
    filters,
    range: resolveReceiptLogRange(filters),
    limit: input.limit,
    offset: input.offset,
  });
}
