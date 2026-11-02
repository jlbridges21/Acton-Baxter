import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { drilldown } from "@/lib/reports/engine";
import { drillSpec } from "@/lib/reports/drill-http";
import { controlStateSchema, requireReportsContext } from "@/lib/reports/http";
import { loadReportFor, recordExecution } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

const bodySchema = z.object({
  state: controlStateSchema,
  spec: z.unknown().optional(),
  widgetId: z.string().min(1).max(40),
  groupKey: z.string().max(300).nullable().optional(),
  seriesKey: z.string().max(300).nullable().optional(),
});

/** Records behind a KPI value or chart segment (authorized columns only). */
export async function POST(request: Request, { params }: Params) {
  try {
    const started = Date.now();
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = bodySchema.parse(await request.json());
    // Drafts only from editors; templates never read a live rule set (same as execute).
    const result = await drilldown({
      spec: drillSpec(report, permission, body.spec),
      access: ctx.access,
      state: body.state,
      widgetId: body.widgetId,
      groupKey: body.groupKey ?? null,
      seriesKey: body.seriesKey ?? null,
    });
    await recordExecution({
      reportId: report.id,
      userId: ctx.user.id,
      kind: "drilldown",
      durationMs: Date.now() - started,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/drilldown");
  }
}
