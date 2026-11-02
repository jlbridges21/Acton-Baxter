import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { drillGroup } from "@/lib/reports/engine";
import { drillSpec } from "@/lib/reports/drill-http";
import { controlStateSchema, requireReportsContext } from "@/lib/reports/http";
import { loadReportFor, recordExecution } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ reportId: string }> };

const bodySchema = z.object({
  state: controlStateSchema,
  spec: z.unknown().optional(),
  widgetId: z.string().min(1).max(40),
  path: z.array(z.string().max(300)).min(1).max(4),
  columnId: z.string().max(48).nullable().optional(),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Records behind a grouped-table group or subtotal, paged on the server, with breadcrumbs and
 * reconciliation. Same authorization as viewing the report; field access is re-checked.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const started = Date.now();
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = bodySchema.parse(await request.json());
    const result = await drillGroup({
      spec: drillSpec(report, permission, body.spec),
      access: ctx.access,
      state: body.state,
      widgetId: body.widgetId,
      path: body.path,
      columnId: body.columnId ?? null,
      offset: body.offset,
      limit: body.limit,
    });
    await recordExecution({
      reportId: report.id,
      userId: ctx.user.id,
      kind: "drilldown",
      durationMs: Date.now() - started,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/drill");
  }
}
