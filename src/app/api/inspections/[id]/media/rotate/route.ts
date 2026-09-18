/**
 * Persist a 90° counter-clockwise photo rotation (re-encode storage object).
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { rotateSiteInspectionMedia } from "@/lib/inspections/records-store";
import { rotateMediaSchema } from "@/lib/inspections/record-schemas";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id: inspectionId } = await params;
    const rate = checkRateLimit(`inspection-media-rotate:${user.id}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const body = rotateMediaSchema.parse(await request.json());
    const inspection = await rotateSiteInspectionMedia({
      inspectionId,
      mediaId: body.mediaId,
      actorId: user.id,
      actorRole: user.profile.role,
    });
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "POST /api/inspections/[id]/media/rotate");
  }
}
