import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { getCostItemAdminOverview } from "@/lib/reports/cost-item-admin";
import { invalidateDataHealthCache } from "@/lib/reports/data-health";
import { invalidateCatalogContext } from "@/lib/reports/engine";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";
import { deleteValueMapping, saveValueMapping } from "@/lib/reports/mappings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cost-item source: freshness, fields, model ↔ budget links, option groups, preview rows. */
export async function GET(request: Request) {
  try {
    await requireReportsAdmin();
    const url = new URL(request.url);
    return jsonOk(
      await getCostItemAdminOverview({
        model: url.searchParams.get("model")?.slice(0, 40) || undefined,
        search: url.searchParams.get("search")?.slice(0, 80) || undefined,
      }),
    );
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/cost-items");
  }
}

const ruleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("model_scope"),
    matchType: z.enum(["prefix", "exact", "contains"]),
    pattern: z.string().trim().min(1).max(120),
    value: z.enum(["include", "exclude"]),
  }),
  z.object({
    kind: z.literal("option_group"),
    matchType: z.enum(["prefix", "exact", "contains"]),
    pattern: z.string().trim().min(1).max(120),
    value: z.enum(["include", "exclude"]),
  }),
]);

function invalidate() {
  invalidateCatalogContext();
  invalidateFieldCatalog();
  invalidateDataHealthCache();
}

/** Add a model-scope or option-group rule (classification only; JobTread is untouched). */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = ruleSchema.parse(await request.json());
    const row = await saveValueMapping(
      {
        kind: body.kind,
        sourceField: body.kind === "model_scope" ? "model.name" : "group.name",
        matchType: body.matchType,
        pattern: body.pattern,
        value: body.value,
        priority: 10,
      },
      ctx.user.id,
    );
    invalidate();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: `reports.${body.kind}_rule_saved`,
      targetType: "bi_value_mapping",
      targetId: row.id,
      summary: `${body.kind === "model_scope" ? "Model" : "Option group"} rule: name ${body.matchType} "${body.pattern}" → ${body.value}.`,
    });
    return jsonOk(await getCostItemAdminOverview());
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/cost-items");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    await deleteValueMapping(id);
    invalidate();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.classification_rule_deleted",
      targetType: "bi_value_mapping",
      targetId: id,
      summary: "Deleted a model or option-group rule.",
    });
    return jsonOk(await getCostItemAdminOverview());
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/admin/cost-items");
  }
}
