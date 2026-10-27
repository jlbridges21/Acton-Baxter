import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { requireReportsAdmin } from "@/lib/reports/http";
import { getRelatedFieldsOverview, setRelatedField } from "@/lib/reports/related-fields";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Related report fields (e.g. job fields on cost items): approved, eligible, match stats. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk({ relationships: await getRelatedFieldsOverview() });
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/related-fields");
  }
}

const bodySchema = z.object({
  relationship: z.enum(["cost_items.job", "commissions.job"]),
  ref: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
});

/** Approve or remove a related field. Only fields that exist on the related source qualify. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = bodySchema.parse(await request.json());
    await setRelatedField(body, ctx.user.id);
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: body.enabled ? "reports.related_field_approved" : "reports.related_field_removed",
      targetType: "bi_related_field",
      targetId: `${body.relationship}:${body.ref}`,
      summary: `${body.enabled ? "Approved" : "Removed"} related field ${body.ref} (${body.relationship}).`,
    });
    return jsonOk({ relationships: await getRelatedFieldsOverview() });
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/related-fields");
  }
}
