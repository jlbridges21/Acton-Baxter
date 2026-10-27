import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { canSeeField } from "@/lib/reports/access";
import { requireReportsContext } from "@/lib/reports/http";
import { canEditMetric, catalogFor, listLibraryMetrics, saveMetric } from "@/lib/reports/metrics";

export const dynamic = "force-dynamic";

/** Metric Library: every metric with whether this person can use and edit it. */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    const [metrics, catalog] = await Promise.all([
      listLibraryMetrics({ includeArchived: archived }),
      catalogFor(),
    ]);
    return jsonOk({
      canPublishCompany: ctx.access.isAdmin || ctx.access.canManage,
      metrics: metrics.map((m) => {
        const ref = `calc:${m.key}`;
        const def = catalog.calcs.get(ref)?.def;
        return {
          key: m.key,
          ref,
          definition: m.definition,
          visibility: m.visibility,
          version: m.version,
          archived: Boolean(m.archived_at),
          updatedAt: m.updated_at,
          mine: m.owner_id === ctx.user.id,
          canEdit: canEditMetric(ctx.access, ctx.user.id, m),
          usable: def ? canSeeField(ctx.access, def) : false,
          accessRequired: def?.category ?? null,
          problem: catalog.calcErrors.get(ref) ?? null,
        };
      }),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/metrics");
  }
}

const saveSchema = z.object({
  definition: z.unknown(),
  visibility: z.enum(["private", "company"]),
  summary: z.string().trim().max(300).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = saveSchema.parse(await request.json());
    const row = await saveMetric({
      definition: body.definition,
      visibility: body.visibility,
      access: ctx.access,
      userId: ctx.user.id,
      authorKind: "user",
      summary: body.summary,
      expectedVersion: body.expectedVersion,
    });
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.metric_saved",
      targetType: "bi_metric",
      targetId: row.id,
      summary: `Saved ${row.visibility} metric calc:${row.key} v${row.version}.`,
    });
    return jsonOk({ key: row.key, version: row.version });
  } catch (error) {
    return jsonError(error, "POST /api/reports/metrics");
  }
}
