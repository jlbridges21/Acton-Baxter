import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  getSiteInspection,
  softDeleteSiteInspection,
  upsertResponseSchema,
  upsertSiteInspectionResponse,
} from "@/lib/inspections";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const inspection = await getSiteInspection(id);
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/[id]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    const parsed = upsertResponseSchema.parse(await request.json());
    const inspection = await upsertSiteInspectionResponse({
      inspectionId: id,
      snapshotItemId: parsed.snapshotItemId,
      isComplete: parsed.isComplete,
      notes: parsed.notes,
      answers: parsed.answers,
      actorId: user.id,
    });
    return jsonOk({ inspection });
  } catch (error) {
    return jsonError(error, "PATCH /api/inspections/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    await softDeleteSiteInspection(id, user.id, user.profile.role);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/inspections/[id]");
  }
}
