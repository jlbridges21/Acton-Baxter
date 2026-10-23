import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { executeReport } from "@/lib/reports/engine";
import { controlStateSchema, requireReportsContext } from "@/lib/reports/http";
import { loadReportFor, recordExecution, updateReportMeta } from "@/lib/reports/repo";
import { parseReportSpec } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ reportId: string }> };

const bodySchema = z.object({
  state: controlStateSchema,
  /** Unsaved editor draft. Executed with the viewer's own data access, never saved here. */
  spec: z.unknown().optional(),
  widgetIds: z.array(z.string().max(40)).max(40).optional(),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = bodySchema.parse(await request.json());
    let spec = report.spec;
    if (body.spec !== undefined) {
      if (!permission.canEdit)
        throw new ValidationError("You can't preview changes to this report.");
      const parsed = parseReportSpec(body.spec);
      if (!parsed.ok)
        throw new ValidationError(parsed.issues.map((i) => `${i.path} — ${i.message}`).join("; "));
      spec = parsed.spec;
    }
    const result = await executeReport({
      spec,
      access: ctx.access,
      state: body.state,
      widgetIds: body.widgetIds,
    });
    await recordExecution({
      reportId: report.id,
      userId: ctx.user.id,
      kind: "view",
      durationMs: result.durationMs,
      restrictedWidgets: result.restrictedWidgets,
      liveRequests: result.freshness.liveFetchedAt ? 1 : 0,
    });
    if (
      result.freshness.syncedAt &&
      result.freshness.syncedAt !== report.last_data_refresh_at &&
      permission.canView
    ) {
      await updateReportMeta(report, { last_data_refresh_at: result.freshness.syncedAt }).catch(
        () => undefined,
      );
    }
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/execute");
  }
}
