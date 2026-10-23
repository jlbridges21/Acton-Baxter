import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { ValidationError } from "@/lib/errors";
import { listCustomFields, updateSemanticField } from "@/lib/jobtread/metadata";
import { getDataSettingsOverview } from "@/lib/reports/admin";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,60}$/),
  customFieldId: z.string().trim().min(4).max(40).nullable(),
});

/** Map a business term (e.g. "Recommended BR Model") to a specific JobTread field id. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = patchSchema.parse(await request.json());
    if (body.customFieldId) {
      const fields = await listCustomFields();
      if (!fields.some((f) => f.id === body.customFieldId))
        throw new ValidationError("That JobTread field wasn't found. Run a sync first.");
    }
    await updateSemanticField(body.key, { custom_field_id: body.customFieldId }, ctx.user.id);
    invalidateFieldCatalog();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "jobtread.mapping_updated",
      targetType: "jobtread_mapping",
      targetId: body.key,
      summary: `Mapped "${body.key}" to ${body.customFieldId ?? "nothing"}.`,
    });
    return jsonOk(await getDataSettingsOverview());
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/admin/semantic");
  }
}
