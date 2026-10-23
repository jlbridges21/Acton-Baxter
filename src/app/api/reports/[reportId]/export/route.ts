import { z } from "zod";
import { jsonError } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { csvFilename, toCsv } from "@/lib/reports/csv";
import { drilldown, executeReport } from "@/lib/reports/engine";
import { controlStateSchema, requireReportsContext } from "@/lib/reports/http";
import { loadReportFor, recordExecution } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ reportId: string }> };

const bodySchema = z.object({
  state: controlStateSchema,
  widgetId: z.string().min(1).max(40),
  groupKey: z.string().max(300).nullable().optional(),
  seriesKey: z.string().max(300).nullable().optional(),
});

/** CSV of one widget's data (tables: their rows; charts: their series; KPIs: their records). */
export async function POST(request: Request, { params }: Params) {
  try {
    const started = Date.now();
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = bodySchema.parse(await request.json());
    const widget = report.spec.widgets.find((w) => w.id === body.widgetId);
    if (!widget) throw new ValidationError("That widget isn't in this report.");

    let csv: string;
    let title = widget.title || report.title;
    if (body.groupKey !== undefined && body.groupKey !== null) {
      const d = await drilldown({
        spec: report.spec,
        access: ctx.access,
        state: body.state,
        widgetId: widget.id,
        groupKey: body.groupKey,
        seriesKey: body.seriesKey ?? null,
      });
      csv = toCsv(
        d.columns.map((c) => c.label),
        d.rows.map((r) => d.columns.map((c) => r.cells[c.key] ?? null)),
      );
      title = d.title;
    } else {
      const result = await executeReport({
        spec: report.spec,
        access: ctx.access,
        state: body.state,
        widgetIds: [widget.id],
      });
      const w = result.widgets[widget.id];
      if (!w || w.status === "restricted" || w.status === "error")
        throw new ValidationError(w?.message ?? "This widget has no data to export.");
      if (w.kind === "table") {
        csv = toCsv(
          w.columns.map((c) => c.label),
          w.rows.map((r) => w.columns.map((c) => r.cells[c.key] ?? null)),
        );
      } else if (w.kind === "chart") {
        const series = w.seriesKeys;
        csv = series.length
          ? toCsv(
              [w.groupLabel, ...series],
              w.points.map((p) => [p.key, ...series.map((s) => p.series?.[s] ?? null)]),
            )
          : toCsv(
              [w.groupLabel, w.metricLabel, "Records"],
              w.points.map((p) => [p.key, p.value, p.count]),
            );
      } else if (w.kind === "kpi") {
        const d = await drilldown({
          spec: report.spec,
          access: ctx.access,
          state: body.state,
          widgetId: widget.id,
        });
        csv = toCsv(
          d.columns.map((c) => c.label),
          d.rows.map((r) => d.columns.map((c) => r.cells[c.key] ?? null)),
        );
      } else if (w.kind === "detail") {
        csv = toCsv(
          ["Field", "Value"],
          w.items.filter((i) => !i.restricted).map((i) => [i.label, i.value]),
        );
      } else if (w.kind === "milestones") {
        csv = toCsv(
          ["Milestone", "Start", "End", "Status", "Completed tasks", "Total tasks"],
          w.milestones.map((m) => [
            m.name,
            m.startDate,
            m.endDate,
            m.status,
            m.completedTasks,
            m.totalTasks,
          ]),
        );
      } else if (w.kind === "documents") {
        csv = toCsv(
          ["Name", "Folder", "Type", "Added"],
          w.files.map((f) => [f.name, f.folder, f.type, f.createdAt]),
        );
      } else {
        throw new ValidationError("This widget has no data to export.");
      }
    }
    await recordExecution({
      reportId: report.id,
      userId: ctx.user.id,
      kind: "export",
      durationMs: Date.now() - started,
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename(`${report.title}-${title}`)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/export");
  }
}
