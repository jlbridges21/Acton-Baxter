import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/agents/audit";
import { requireReportsContext } from "@/lib/reports/http";
import {
  addShare,
  listShares,
  loadReportFor,
  removeShare,
  updateReportMeta,
} from "@/lib/reports/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canShare)
      throw new AuthorizationError(
        "Only the owner or an administrator can see who this report is shared with.",
      );
    return jsonOk({
      visibility: report.visibility,
      ownerId: report.owner_id,
      shares: await listShares(report.id),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/shares");
  }
}

const addSchema = z.object({
  principalType: z.enum(["user", "department", "role"]),
  principalValue: z.string().trim().min(1).max(200),
  permission: z.enum(["view", "edit"]),
});

/**
 * Share the report definition. Recipients still see only the data their own access
 * allows — sharing never grants customer, financial, or internal fields.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canShare || report.is_template)
      throw new AuthorizationError("Only the owner or an administrator can share this report.");
    const body = addSchema.parse(await request.json());
    if (
      body.principalType === "role" &&
      !["user", "admin", "super_admin"].includes(body.principalValue)
    ) {
      throw new ValidationError("Unknown role.");
    }
    await addShare({
      report_id: report.id,
      principal_type: body.principalType,
      principal_value: body.principalValue,
      permission: body.permission,
      created_by: ctx.user.id,
    });
    if (report.visibility === "private") await updateReportMeta(report, { visibility: "shared" });
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "report.shared",
      targetType: "report",
      targetId: report.id,
      summary: `Shared "${report.title}" with ${body.principalType} ${body.principalValue} (${body.permission}).`,
      details: body,
    }).catch(() => undefined);
    return jsonOk({ shares: await listShares(report.id) });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/shares");
  }
}

const removeSchema = z.object({ shareId: z.string().uuid() });

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canShare)
      throw new AuthorizationError("Only the owner or an administrator can change sharing.");
    const { shareId } = removeSchema.parse(await request.json());
    await removeShare(report.id, shareId);
    const remaining = await listShares(report.id);
    if (!remaining.length && report.visibility === "shared")
      await updateReportMeta(report, { visibility: "private" });
    return jsonOk({ shares: remaining });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/[reportId]/shares");
  }
}
