/**
 * Sort helpers for expense_jobs listing.
 *
 * Default arrangement:
 * 1. Admin `sort_order` wins (explicit reorder / set values).
 * 2. On equal sort_order: custom jobs before project jobs.
 * 3. Project jobs: descending project number (L01-26019 above L01-26018).
 * 4. Customs / ties: label A→Z.
 *
 * New project rows sync into a high sort_order band (1_000_000) so they sit
 * after typical custom entries until an admin reorders.
 */

import type { ExpenseJobSource } from "./types";

export const PROJECT_JOB_SORT_BAND = 1_000_000;

export type ExpenseJobSortable = {
  source: ExpenseJobSource;
  sortOrder: number;
  projectNumber: string | null;
  label: string;
};

/** Numeric-aware descending compare for project numbers like L01-26019. */
export function compareProjectNumberDesc(a: string | null, b: string | null): number {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (left === right) return 0;
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" });
}

export function compareExpenseJobsForList(a: ExpenseJobSortable, b: ExpenseJobSortable): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.source !== b.source) return a.source === "custom" ? -1 : 1;
  if (a.source === "project") {
    const byNumber = compareProjectNumberDesc(a.projectNumber, b.projectNumber);
    if (byNumber !== 0) return byNumber;
  }
  return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}
