import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { drilldown } from "@/lib/reports/engine";
import { controlStateSchema, requireReportsContext } from "@/lib/reports/http";
import { loadReportFor, recordExecution } from "@/lib/reports/repo";
import { parseReportSpec } from "@/lib/reports/spec";

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
    let spec = report.spec;
    if (body.spec !== undefined && permission.canEdit) {
      const parsed = parseReportSpec(body.spec);
      if (!parsed.ok) throw new ValidationError("The draft report isn't valid.");
      spec = parsed.spec;
    }
    const result = await drilldown({
      spec,
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
