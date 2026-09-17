/**
 * Build readable expense-job labels from Master Project Log rows.
 */

import type { ProjectLogRow } from "@/lib/baxter-data/project-registry";

/**
 * e.g. "L01-26019 Liniger — 25 N Avalon Dr, Los Altos"
 */
export function formatProjectExpenseJobLabel(row: ProjectLogRow): string {
  const head = [row.projectNumber.trim(), row.shortName.trim()].filter(Boolean).join(" ");
  const street = row.street.trim();
  const city = row.city.trim();
  const place = [street, city].filter(Boolean).join(", ");
  if (head && place) return `${head} — ${place}`;
  if (head) return head;
  return row.customerName.trim() || "Untitled project";
}
