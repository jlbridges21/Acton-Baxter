import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import {
  createBusinessField,
  getBusinessFieldsOverview,
  importRequestedBusinessFields,
  reconcileAutoMappings,
  setBusinessFieldArchived,
  updateBusinessField,
} from "@/lib/jobtread/business-fields";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,60}$/);
const fieldId = z.string().trim().min(4).max(40);

/** Business fields with mapping status, report usage, and the JobTread fields to map to. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await getBusinessFieldsOverview());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/business-fields");
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(600).nullable().optional(),
    category: z.string().max(40).nullable().optional(),
    type: z.string().max(20).nullable().optional(),
    customFieldId: fieldId.nullable().optional(),
  }),
  z.object({ action: z.literal("restore"), key }),
  z.object({ action: z.literal("import") }),
  z.object({ action: z.literal("automap") }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = postSchema.parse(await request.json());
    const actor = { userId: ctx.user.id, label: ctx.requester.label };
    let summary: string;
    let message: string | null = null;
    if (body.action === "create") {
      const row = await createBusinessField(body, ctx.user.id);
      summary = `Added business field "${row.label}" (${row.key}).`;
    } else if (body.action === "restore") {
      await setBusinessFieldArchived(body.key, false, ctx.user.id);
      summary = `Restored business field ${body.key}.`;
    } else if (body.action === "import") {
      const r = await importRequestedBusinessFields();
      summary = r.skipped
        ? "Spreadsheet import skipped: JobTread fields haven't been synced yet."
        : `Spreadsheet import: ${r.created} added, ${r.linked} matched to existing fields, ${r.autoMapped} mapped by verified exact match, ${r.unmapped} left for review.`;
      message = summary;
    } else {
      const n = await reconcileAutoMappings();
      summary = `Mapped ${n} business field${n === 1 ? "" : "s"} by verified exact match.`;
      message = summary;
    }
    invalidateFieldCatalog();
    invalidateDataHealthCache();
    await recordAudit({
      actor,
      action: `reports.business_field.${body.action}`,
      targetType: "business_field",
      targetId: "key" in body ? body.key : null,
      summary,
    });
    return jsonOk({ ...(await getBusinessFieldsOverview()), message });
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/business-fields");
  }
}

const patchSchema = z.object({
  key,
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  customFieldId: fieldId.nullable().optional(),
});

/** Rename, describe, or (re)map a business field. Report specs keep using the same key. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = patchSchema.parse(await request.json());
    await updateBusinessField(body.key, body, ctx.user.id);
    invalidateFieldCatalog();
    invalidateDataHealthCache();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.business_field.update",
      targetType: "business_field",
      targetId: body.key,
      summary: `Updated business field ${body.key}${body.customFieldId !== undefined ? ` (mapped to ${body.customFieldId ?? "nothing"})` : ""}.`,
      details: body,
    });
    return jsonOk(await getBusinessFieldsOverview());
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/admin/business-fields");
  }
}

/** Remove = archive. The key stays reserved so reports using it show a clear message. */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const k = key.parse(new URL(request.url).searchParams.get("key"));
    await setBusinessFieldArchived(k, true, ctx.user.id);
    invalidateFieldCatalog();
    invalidateDataHealthCache();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.business_field.archive",
      targetType: "business_field",
      targetId: k,
      summary: `Removed (archived) business field ${k}.`,
    });
    return jsonOk(await getBusinessFieldsOverview());
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/admin/business-fields");
  }
}
