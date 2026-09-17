/**
 * Job combobox helpers for Receipt Log — free-text create vs existing jobs.
 */

/** Trimmed custom label to store; empty string means do not create. */
export function normalizeCustomJobLabel(query: string): string {
  return query.trim();
}

/**
 * Offer "+ Create '<text>'" when the typed query is non-empty and does not
 * exactly match an existing job label (case-insensitive). Partial matches
 * still allow create so "John" can be created while "Johnson" is listed.
 */
export function shouldOfferCreateCustomJob(query: string, jobLabels: readonly string[]): boolean {
  const trimmed = normalizeCustomJobLabel(query);
  if (!trimmed) return false;
  const needle = trimmed.toLowerCase();
  return !jobLabels.some((label) => label.trim().toLowerCase() === needle);
}
