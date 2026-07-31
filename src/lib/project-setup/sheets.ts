import "server-only";

import { googleFetch } from "@/lib/connectors/google/auth";

/**
 * Read column A of a Google Sheet tab (read-only scopes).
 */
export async function readSheetColumnA(input: {
  spreadsheetId: string;
  tabName: string;
}): Promise<string[][]> {
  const tab = input.tabName.replace(/'/g, "''");
  const range = encodeURIComponent(`'${tab}'!A:A`);
  try {
    const valuesData = await googleFetch<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
    );
    return (valuesData.values ?? []).map((row) => row.map((cell) => String(cell ?? "").trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sheets error";
    throw new Error(
      `Could not read the Master Project Log tab "${input.tabName}" from Google Sheets. ${message}`,
    );
  }
}
