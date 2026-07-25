import "server-only";

import { exportDriveFile } from "./drive";
import { googleFetch } from "./auth";
import { parseWorkbookFromSheets } from "@/lib/knowledge-index/spreadsheet-parser";
import type { ParsedWorkbook } from "@/lib/knowledge-index/types";

const MAX_SHEETS = 12;

export type ParsedSheetTab = {
  title: string;
  headers: string[];
  rowCount: number;
  truncated: boolean;
  text: string;
  gid: number | null;
  grid: string[][];
};

/**
 * Prefer Sheets API values for structured tabs; fall back to CSV export.
 * Uses header-row detection and produces human-readable Key: Value rows (not col2=).
 */
export async function exportGoogleSheetStructured(fileId: string): Promise<{
  contentText: string;
  tabs: ParsedSheetTab[];
  truncated: boolean;
  workbook: ParsedWorkbook;
}> {
  try {
    const meta = await googleFetch<{
      sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
      properties?: { title?: string };
    }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=properties.title,sheets.properties.title,sheets.properties.sheetId`,
    );

    const sheetProps = (meta.sheets ?? [])
      .map((s) => ({
        title: s.properties?.title,
        gid: s.properties?.sheetId ?? null,
      }))
      .filter((t): t is { title: string; gid: number | null } => Boolean(t.title))
      .slice(0, MAX_SHEETS);

    if (sheetProps.length === 0) {
      const csv = await exportDriveFile(fileId, "text/csv");
      const grid = csv
        .split(/\r?\n/)
        .filter((line) => line.length)
        .map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
      const workbook = parseWorkbookFromSheets(meta.properties?.title ?? fileId, [
        { name: "Sheet1", gid: null, grid },
      ]);
      return {
        contentText: workbook.contentText,
        tabs: [
          {
            title: "Sheet1",
            headers: workbook.sheets[0]?.tables[0]?.headers ?? [],
            rowCount: grid.length,
            truncated: false,
            text: workbook.contentText,
            gid: null,
            grid,
          },
        ],
        truncated: workbook.truncated,
        workbook,
      };
    }

    const sheetGrids: Array<{ name: string; gid: number | null; grid: string[][] }> = [];
    for (const sheet of sheetProps) {
      const range = encodeURIComponent(`'${sheet.title.replace(/'/g, "''")}'`);
      const valuesData = await googleFetch<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
      );
      const rows = (valuesData.values ?? []).map((row) =>
        row.map((cell) => String(cell ?? "").trim()),
      );
      sheetGrids.push({ name: sheet.title, gid: sheet.gid, grid: rows });
    }

    const workbook = parseWorkbookFromSheets(meta.properties?.title ?? fileId, sheetGrids);

    const tabs: ParsedSheetTab[] = workbook.sheets.map((sheet) => {
      const primary = sheet.tables[0];
      return {
        title: sheet.name,
        headers: primary?.headers ?? [],
        rowCount: sheet.rawGrid.length,
        truncated: false,
        text: sheet.tables.flatMap((t) => t.rows.map((r) => r.displayLines)).join("\n\n"),
        gid: sheet.gid,
        grid: sheet.rawGrid,
      };
    });

    return {
      contentText: workbook.contentText,
      tabs,
      truncated: workbook.truncated || (meta.sheets?.length ?? 0) > MAX_SHEETS,
      workbook,
    };
  } catch {
    const csv = await exportDriveFile(fileId, "text/csv");
    const grid = csv
      .split(/\r?\n/)
      .filter((line) => line.length)
      .map((line) => line.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
    const workbook = parseWorkbookFromSheets("Export", [{ name: "Export", gid: null, grid }]);
    return {
      contentText: workbook.contentText || csv,
      tabs: [
        {
          title: "Export",
          headers: workbook.sheets[0]?.tables[0]?.headers ?? [],
          rowCount: grid.length,
          truncated: false,
          text: workbook.contentText || csv,
          gid: null,
          grid,
        },
      ],
      truncated: false,
      workbook,
    };
  }
}

/** @deprecated Prefer exportGoogleSheetStructured */
export async function exportGoogleSheetCsv(fileId: string): Promise<string> {
  const structured = await exportGoogleSheetStructured(fileId);
  return structured.contentText;
}
