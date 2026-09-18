/**
 * Update upload_status / progress while the client drains the IndexedDB queue.
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { updateSiteInspectionMediaStatus } from "@/lib/inspections/records-store";
import { mediaStatusSchema } from "@/lib/inspections/record-schemas";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id: inspectionId } = await params;
    const rate = checkRateLimit(`inspection-media-status:${user.id}`, {
      limit: 120,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const body = mediaStatusSchema.parse(await request.json());
    const inspection = await updateSiteInspectionMediaStatus({
      inspectionId,
      clientMediaId: body.clientMediaId,
      uploadStatus: body.uploadStatus,
      uploadProgress: body.uploadProgress,
    });
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "PATCH /api/inspections/[id]/media/status");
  }
}
