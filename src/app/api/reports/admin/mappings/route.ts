import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import { requireReportsAdmin } from "@/lib/reports/http";
import {
  deleteValueMapping,
  getRegionMappingOverview,
  saveValueMapping,
} from "@/lib/reports/mappings";

export const dynamic = "force-dynamic";

/** Region rules and the Product Library models they resolve. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await getRegionMappingOverview());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/mappings");
  }
}

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.literal("region"),
  sourceField: z.literal("model.name"),
  matchType: z.enum(["prefix", "exact", "contains"]),
  pattern: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120),
  priority: z.number().int().min(0).max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = saveSchema.parse(await request.json());
    const row = await saveValueMapping(body, ctx.user.id);
    invalidateDataHealthCache();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.mapping_saved",
      targetType: "bi_value_mapping",
      targetId: row.id,
      summary: `Region rule: model name ${body.matchType} "${body.pattern}" → ${body.value}.`,
    });
    return jsonOk(await getRegionMappingOverview());
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/mappings");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    await deleteValueMapping(id);
    invalidateDataHealthCache();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.mapping_deleted",
      targetType: "bi_value_mapping",
      targetId: id,
      summary: "Deleted a region rule.",
    });
    return jsonOk(await getRegionMappingOverview());
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/admin/mappings");
  }
}
