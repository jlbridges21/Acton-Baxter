import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { NotFoundError } from "@/lib/errors";
import { requireReportsContext } from "@/lib/reports/http";
import { archiveMetric, getMetric, listMetricVersions, metricUsage } from "@/lib/reports/metrics";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

/** Versions and usage (reports and metrics that reference it) of one library metric. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireReportsContext();
    const { key } = await params;
    const metric = await getMetric(key);
    if (!metric) throw new NotFoundError("Metric not found");
    const [versions, usage] = await Promise.all([listMetricVersions(metric.id), metricUsage(key)]);
    return jsonOk({
      versions: versions.map((v) => ({
        version: v.version,
        definition: v.definition,
        visibility: v.visibility,
        summary: v.change_summary,
        authorKind: v.author_kind,
        createdAt: v.created_at,
      })),
      usage,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/metrics/[key]");
  }
}

/** Archive or restore (history is kept). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { key } = await params;
    const { archived } = z.object({ archived: z.boolean() }).parse(await request.json());
    const row = await archiveMetric({ key, archived, access: ctx.access, userId: ctx.user.id });
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: archived ? "reports.metric_archived" : "reports.metric_restored",
      targetType: "bi_metric",
      targetId: row.id,
      summary: `${archived ? "Archived" : "Restored"} metric calc:${key}.`,
    });
    return jsonOk({ key, archived });
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/metrics/[key]");
  }
}
