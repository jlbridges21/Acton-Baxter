import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import {
  getSiteInspection,
  setInspectionStatusSchema,
  setSiteInspectionStatus,
  softDeleteSiteInspection,
  updateSiteInspectionAddress,
  updateSiteInspectionAddressSchema,
  updateSiteInspectionDetails,
  updateSiteInspectionDetailsSchema,
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

    if ("snapshotItemId" in body) {
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
    }

    if ("projectName" in body) {
      const parsed = updateSiteInspectionDetailsSchema.parse(body);
      const inspection = await updateSiteInspectionDetails({
        inspectionId: id,
        projectName: parsed.projectName,
        address: parsed.address,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        assignedTo: parsed.assignedTo,
        jobId: parsed.jobId,
        actorId: user.id,
        actorRole: user.profile.role,
      });
      return jsonOk({ inspection });
    }

    if ("address" in body && !("status" in body)) {
      const parsed = updateSiteInspectionAddressSchema.parse(body);
      const inspection = await updateSiteInspectionAddress({
        inspectionId: id,
        address: parsed.address,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        actorId: user.id,
        actorRole: user.profile.role,
      });
      return jsonOk({ inspection });
    }

    if ("status" in body) {
      const parsed = setInspectionStatusSchema.parse(body);
      const inspection = await setSiteInspectionStatus({
        inspectionId: id,
        status: parsed.status,
        actorId: user.id,
      });
      return jsonOk({ inspection });
    }

    throw new ValidationError("Provide snapshotItemId (response patch) or status");
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
