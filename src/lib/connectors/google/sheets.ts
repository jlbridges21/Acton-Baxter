import "server-only";

import { exportDriveFile } from "./drive";

/** Export a Google Sheet as CSV text. */
export async function exportGoogleSheetCsv(fileId: string): Promise<string> {
  return exportDriveFile(fileId, "text/csv");
}
