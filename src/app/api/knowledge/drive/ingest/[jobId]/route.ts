import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getDriveIngestProgress } from "@/lib/knowledge/user-drive-ingest";
import { NotFoundError, AuthorizationError } from "@/lib/errors";

/**
 * Poll one-time Drive ingest progress (job metadata).
 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireActiveUser();
    const { jobId } = await context.params;
    const progress = await getDriveIngestProgress(jobId);
    if (!progress) throw new NotFoundError("Ingest job not found");
    if (progress.userId !== user.id) {
      throw new AuthorizationError("You can only view your own Drive imports");
    }
    return jsonOk(progress);
  } catch (error) {
    return jsonError(error, "GET /api/knowledge/drive/ingest/[jobId]");
  }
}
