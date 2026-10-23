import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { requireReportsContext } from "@/lib/reports/http";
import {
  createReport,
  duplicateReport,
  getReport,
  listReportsFor,
  loadReportFor,
} from "@/lib/reports/repo";
import { BLANK_SPEC } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";

/** Reports the signed-in user can open (definitions only — no data). */
export async function GET() {
  try {
    const ctx = await requireReportsContext();
    const items = await listReportsFor(ctx.requester, ctx.access);
    return jsonOk({
      reports: items.map(({ report, permission, viewedAt, pinned, shareCount }) => ({
        id: report.id,
        title: report.title,
        description: report.description,
        ownerId: report.owner_id,
        isMine: report.owner_id !== null && report.owner_id === ctx.user.id,
        visibility: report.visibility,
        isTemplate: report.is_template,
        templateKey: report.template_key,
        status: report.status,
        pinned,
        version: report.version,
        widgetCount: report.spec.widgets.length,
        sources: [...new Set(report.spec.datasets.map((d) => d.source))],
        createdByDexter: report.created_by_agent,
        updatedAt: report.updated_at,
        viewedAt,
        shareCount,
        permission,
      })),
      access: {
        canChat: ctx.access.canChat,
        canManage: ctx.access.canManage,
        isAdmin: ctx.access.isAdmin,
        categories: [...ctx.access.categories],
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports");
  }
}

const createSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("blank"), title: z.string().trim().min(1).max(160).optional() }),
  z.object({
    from: z.literal("report"),
    reportId: z.string().uuid(),
    title: z.string().trim().min(1).max(160).optional(),
  }),
]);

/** Create a blank report, or a private copy of a template / report the user can view. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = createSchema.parse(await request.json());
    if (body.from === "blank") {
      const report = await createReport({
        spec: { ...BLANK_SPEC, title: body.title ?? "Untitled report" },
        ownerId: ctx.user.id,
        authorKind: "user",
      });
      return jsonOk({ id: report.id }, { status: 201 });
    }
    if (!(await getReport(body.reportId))) throw new NotFoundError("Report not found");
    const { report } = await loadReportFor(body.reportId, ctx.requester, ctx.access);
    const copy = await duplicateReport(report, ctx.user.id, body.title);
    return jsonOk({ id: copy.id }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/reports");
  }
}
