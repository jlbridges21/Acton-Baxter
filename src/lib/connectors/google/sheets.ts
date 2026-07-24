import "server-only";

import { exportDriveFile } from "./drive";
import { googleFetch } from "./auth";

const MAX_SHEETS = 10;
const MAX_ROWS_PER_SHEET = 200;
const MAX_COLS = 40;

export type ParsedSheetTab = {
  title: string;
  headers: string[];
  rowCount: number;
  truncated: boolean;
  text: string;
};

/**
 * Prefer Sheets API values for structured tabs; fall back to CSV export.
 */
export async function exportGoogleSheetStructured(fileId: string): Promise<{
  contentText: string;
  tabs: ParsedSheetTab[];
  truncated: boolean;
}> {
  try {
    const meta = await googleFetch<{
      sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
      properties?: { title?: string };
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=properties.title,sheets.properties.title,sheets.properties.sheetId`,
    );

    const sheetTitles = (meta.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, MAX_SHEETS);

    if (sheetTitles.length === 0) {
      const csv = await exportDriveFile(fileId, "text/csv");
      return {
        contentText: csv,
        tabs: [
          {
            title: "Sheet1",
            headers: [],
            rowCount: csv.split("\n").length,
            truncated: false,
            text: csv,
          },
        ],
        truncated: false,
      };
    }

    const tabs: ParsedSheetTab[] = [];
    let anyTruncated = false;

    for (const title of sheetTitles) {
      const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
      const valuesData = await googleFetch<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
      );
      const rows = valuesData.values ?? [];
      const truncated = rows.length > MAX_ROWS_PER_SHEET;
      if (truncated) anyTruncated = true;
      const limited = rows.slice(0, MAX_ROWS_PER_SHEET).map((row) => row.slice(0, MAX_COLS));
      const headers = (limited[0] ?? []).map((cell) => String(cell ?? "").trim());
      const body = limited.slice(1);
      const lines: string[] = [];
      lines.push(`## Sheet: ${title}`);
      if (headers.length) lines.push(`Headers: ${headers.join(" | ")}`);
      for (let i = 0; i < body.length; i += 1) {
        const row = body[i] ?? [];
        const cells = row.map((cell, idx) => {
          const header = headers[idx] || `col${idx + 1}`;
          return `${header}=${String(cell ?? "").trim()}`;
        });
        lines.push(`Row ${i + 1}: ${cells.join("; ")}`);
      }
      if (truncated) {
        lines.push(`… truncated after ${MAX_ROWS_PER_SHEET} rows`);
      }
      const text = lines.join("\n");
      tabs.push({
        title,
        headers,
        rowCount: rows.length,
        truncated,
        text,
      });
    }

    if ((meta.sheets?.length ?? 0) > MAX_SHEETS) anyTruncated = true;

    const contentText = [
      `Spreadsheet: ${meta.properties?.title ?? fileId}`,
      ...tabs.map((tab) => tab.text),
      anyTruncated ? "\n[Spreadsheet content truncated for Baxter indexing.]" : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return { contentText, tabs, truncated: anyTruncated };
  } catch {
    const csv = await exportDriveFile(fileId, "text/csv");
    return {
      contentText: csv,
      tabs: [
        {
          title: "Export",
          headers: [],
          rowCount: csv.split("\n").length,
          truncated: false,
          text: csv,
        },
      ],
      truncated: false,
    };
  }
}

/** @deprecated Prefer exportGoogleSheetStructured */
export async function exportGoogleSheetCsv(fileId: string): Promise<string> {
  const structured = await exportGoogleSheetStructured(fileId);
  return structured.contentText;
}
