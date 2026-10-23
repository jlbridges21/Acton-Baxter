import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { updateCustomFieldSettings } from "@/lib/jobtread/metadata";
import { getDataSettingsOverview } from "@/lib/reports/admin";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  id: z.string().trim().min(4).max(40),
  category: z.enum(["general", "customer", "financial", "internal", "excluded"]).optional(),
  displayName: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(600).nullable().optional(),
});

/** Change a JobTread field's access category, display name, or description. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = patchSchema.parse(await request.json());
    await updateCustomFieldSettings(body.id, {
      ...(body.category ? { category: body.category } : {}),
      ...(body.displayName !== undefined ? { display_name: body.displayName || null } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
    });
    invalidateFieldCatalog();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "jobtread.field_updated",
      targetType: "jobtread_field",
      targetId: body.id,
      summary: `Updated JobTread field ${body.id}${body.category ? ` (category: ${body.category})` : ""}.`,
      details: body,
    });
    return jsonOk(await getDataSettingsOverview());
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/admin/fields");
  }
}
