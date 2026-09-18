/**
 * Mark a direct-to-storage upload as ready and create/attach the media row.
 * Rows are created here (after bytes land), never at prepare/enqueue time.
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { completeSiteInspectionMedia } from "@/lib/inspections/records-store";
import { completeMediaSchema } from "@/lib/inspections/record-schemas";

export const runtime = "nodejs";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id: inspectionId } = await params;
    const rate = checkRateLimit(`inspection-media-complete:${user.id}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const body = completeMediaSchema.parse(await request.json());
    const inspection = await completeSiteInspectionMedia({
      inspectionId,
      clientMediaId: body.clientMediaId,
      snapshotItemId: body.snapshotItemId,
      mediaType: body.mediaType,
      mimeType: body.mimeType,
      storagePath: body.storagePath,
      byteSize: body.byteSize,
      posterStoragePath: body.posterStoragePath,
      actorId: user.id,
    });
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "POST /api/inspections/[id]/media/complete");
  }
}
