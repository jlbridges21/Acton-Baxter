import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { enqueueUserDriveIngest } from "@/lib/knowledge/user-drive-ingest";
import { ValidationError } from "@/lib/errors";

/**
 * Start a one-time Drive → draft ingest job for the signed-in user.
 * Does not register recurring google_source_selections.
 */
export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = (await request.json()) as { googleFileIds?: unknown };
    const googleFileIds = Array.isArray(body.googleFileIds)
      ? body.googleFileIds.filter((id): id is string => typeof id === "string")
      : [];
    if (googleFileIds.length === 0) {
      throw new ValidationError("Select at least one Drive file.");
    }
    const { jobId } = await enqueueUserDriveIngest({
      userId: user.id,
      googleFileIds,
    });
    return jsonOk({ jobId }, { status: 202 });
  } catch (error) {
    return jsonError(error, "POST /api/knowledge/drive/ingest");
  }
}
