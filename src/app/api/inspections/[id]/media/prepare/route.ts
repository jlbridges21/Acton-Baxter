/**
 * Prepare a media slot and return direct-to-storage upload credentials.
 * File bytes never pass through this handler.
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { prepareSiteInspectionMedia } from "@/lib/inspections/records-store";
import { prepareMediaSchema } from "@/lib/inspections/record-schemas";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id: inspectionId } = await params;
    const rate = checkRateLimit(`inspection-media-prepare:${user.id}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const body = prepareMediaSchema.parse(await request.json());
    const result = await prepareSiteInspectionMedia({
      inspectionId,
      snapshotItemId: body.snapshotItemId,
      clientMediaId: body.clientMediaId,
      mediaType: body.mediaType,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
      actorId: user.id,
    });
    return jsonOk(result, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/inspections/[id]/media/prepare");
  }
}
