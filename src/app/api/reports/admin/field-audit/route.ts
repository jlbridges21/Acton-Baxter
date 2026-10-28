import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { applyAliasRepair, previewAliasRepair } from "@/lib/jobtread/alias-repair";
import { requireReportsAdmin } from "@/lib/reports/http";
import { applyReportRepair, auditAll, previewReportRepair } from "@/lib/reports/report-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Field problems across reports, saved views, and library metrics (bounded). */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await auditAll({ limit: 500 }));
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/field-audit");
  }
}

const repairSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remap"), fieldId: z.string().trim().min(6).max(44) }),
  z.object({ action: z.literal("apply_suggested") }),
  z.object({ action: z.literal("clear") }),
  z.object({ action: z.literal("deprecate"), note: z.string().max(400).optional() }),
  z.object({ action: z.literal("verify"), note: z.string().max(400).optional() }),
]);

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.enum(["report_preview", "report_apply"]),
    reportId: z.string().uuid(),
    replacements: z.record(z.string().max(80), z.string().max(80)).optional(),
    expectedVersion: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.enum(["alias_preview", "alias_apply"]),
    key: z.string().regex(/^[a-z0-9_]{2,60}$/),
    repair: repairSchema,
  }),
]);

/** Dry-run or apply a repair. Applying a report repair saves a new report version. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = bodySchema.parse(await request.json());
    if ("reportId" in body && body.op === "report_preview") {
      const { spec: _spec, ...preview } = await previewReportRepair({
        reportId: body.reportId,
        access: ctx.access,
        replacements: body.replacements,
      });
      void _spec;
      return jsonOk(preview);
    }
    if ("reportId" in body && body.op === "report_apply") {
      const { spec: _spec, ...result } = await applyReportRepair({
        reportId: body.reportId,
        access: ctx.access,
        userId: ctx.user.id,
        authorKind: "user",
        replacements: body.replacements,
        expectedVersion: body.expectedVersion,
      });
      void _spec;
      if (result.saved)
        await recordAudit({
          actor: { userId: ctx.user.id, label: ctx.requester.label },
          action: "reports.field_repair_applied",
          targetType: "bi_report",
          targetId: body.reportId,
          summary: `Field repair saved as version ${result.version}: ${result.changes.length} reference(s) changed.`,
        });
      return jsonOk(result);
    }
    if (!("key" in body)) throw new Error("Unknown operation.");
    if (body.op === "alias_preview") return jsonOk(await previewAliasRepair(body.key, body.repair));
    const result = await applyAliasRepair(body.key, body.repair, ctx.user.id);
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.alias_repaired",
      targetType: "jt_semantic_field",
      targetId: body.key,
      summary: `sem:${body.key}: ${body.repair.action}${result.to ? ` → cf:${result.to.id} (${result.to.name})` : ""}.`,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/field-audit");
  }
}
