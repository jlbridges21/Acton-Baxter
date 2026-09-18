import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import {
  getSiteInspection,
  setInspectionStatusSchema,
  setSiteInspectionStatus,
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
    const body = (await request.json()) as Record<string, unknown>;

    if ("status" in body && !("snapshotItemId" in body)) {
      const parsed = setInspectionStatusSchema.parse(body);
      const inspection = await setSiteInspectionStatus({
        inspectionId: id,
        status: parsed.status,
        actorId: user.id,
      });
      return jsonOk({ inspection });
    }

    if (!("snapshotItemId" in body)) {
      throw new ValidationError("Provide snapshotItemId (response patch) or status");
    }

    const parsed = upsertResponseSchema.parse(body);
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
