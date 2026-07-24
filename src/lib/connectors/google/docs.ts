import "server-only";

import { exportDriveFile } from "./drive";

/** Export a Google Doc as plain text. */
export async function exportGoogleDocText(fileId: string): Promise<string> {
  return exportDriveFile(fileId, "text/plain");
}
