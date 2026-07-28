import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, NotFoundError } from "@/lib/errors";
import { updatePemNeatInputSchema } from "@/lib/pem-neat/schemas";
import { resolveSalespersonDisplayName } from "@/lib/pem-neat/salespeople";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireActiveUser();
    const { id } = await context.params;
    const record = await getPemNeatStore().get(id);
    if (!record) {
      throw new NotFoundError("PEM NEAT not found");
    }
    return jsonOk({ item: record });
  } catch (error) {
    return jsonError(error, "GET /api/pem-neats/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updatePemNeatInputSchema.parse(body);

    const salesperson = await resolveSalespersonDisplayName(parsed.salespersonUserId);
    const existing = await getPemNeatStore().get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");

    let displayName = salesperson?.displayName;
    if (!displayName) {
      // Allow keeping a historical salesperson who left Sales.
      if (existing.salesperson_user_id === parsed.salespersonUserId) {
        displayName = existing.salesperson_display_name;
      } else {
        throw new AppError("Select a valid salesperson from the Sales department", {
          code: "VALIDATION_ERROR",
          statusCode: 400,
        });
      }
    }

    const result = await getPemNeatStore().updateSource(id, {
      prospectName: parsed.prospectName,
      salespersonUserId: parsed.salespersonUserId,
      salespersonDisplayName: displayName,
      meetingDate: parsed.meetingDate ?? null,
      transcript: parsed.transcript,
      updatedBy: user.id,
    });

    console.info("[pem-neat] updated", {
      id,
      transcriptChanged: result.transcriptChanged,
      prospectNameChanged: result.prospectNameChanged,
      status: result.record.status,
    });

    return jsonOk({
      item: result.record,
      transcriptChanged: result.transcriptChanged,
      prospectNameChanged: result.prospectNameChanged,
    });
  } catch (error) {
    return jsonError(error, "PATCH /api/pem-neats/[id]");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const { id } = await context.params;
    await getPemNeatStore().softDelete(id, user.id);
    console.info("[pem-neat] soft-deleted", { id });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/pem-neats/[id]");
  }
}
