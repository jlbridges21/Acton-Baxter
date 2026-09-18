/**
 * Legacy FormData upload removed — clients must use prepare → direct storage → complete.
 * Kept as a clear 410 so old clients fail loudly instead of silently buffering through Vercel.
 * DELETE removes one media row + storage object (uploader or admin).
 */
import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { deleteMediaSchema, deleteSiteInspectionMedia } from "@/lib/inspections";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST() {
  return NextResponse.json(
    {
      error: {
        message:
          "Direct FormData upload is retired. Use /media/prepare, upload to storage, then /media/complete.",
      },
    },
    { status: 410 },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    const parsed = deleteMediaSchema.parse(await request.json());
    const inspection = await deleteSiteInspectionMedia({
      inspectionId: id,
      mediaId: parsed.mediaId,
      actorId: user.id,
      actorRole: user.profile.role,
    });
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "DELETE /api/inspections/[id]/media");
  }
}
