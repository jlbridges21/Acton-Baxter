/**
 * Project Charter List row builder — single place to adjust column layout.
 */

export type CharterListRowInput = {
  /** Display label, e.g. "Wright Project Charter". */
  charterName: string;
  /** Drive webViewLink for the copied charter spreadsheet. */
  webViewLink: string;
};

/**
 * Build cells for the next Project Charter List row.
 * Column A: HYPERLINK formula showing the charter name, linking to Drive.
 * Adjust this function only if the live tab layout differs.
 */
export function buildCharterListRowValues(input: CharterListRowInput): string[] {
  const label = input.charterName.replace(/"/g, '""');
  const url = input.webViewLink.replace(/"/g, '""');
  return [`=HYPERLINK("${url}","${label}")`];
}

/**
 * True when any cell in the tab already references this charter (by file id or URL).
 */
export function charterListAlreadyHasCharter(
  rows: string[][],
  markers: { fileId?: string | null; webViewLink?: string | null },
): boolean {
  const needles = [markers.fileId, markers.webViewLink]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => v.trim().toLowerCase());
  if (needles.length === 0) return false;

  for (const row of rows) {
    for (const cell of row) {
      const lower = String(cell ?? "").toLowerCase();
      if (!lower) continue;
      if (needles.some((n) => lower.includes(n))) return true;
    }
  }
  return false;
}
