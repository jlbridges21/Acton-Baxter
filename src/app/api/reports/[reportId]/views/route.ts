import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { loadReportFor } from "@/lib/reports/repo";
import { deleteView, listSavedViews, saveView } from "@/lib/reports/saved-views";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

const views = (rows: Awaited<ReturnType<typeof listSavedViews>>) =>
  rows.map((v) => ({ id: v.id, name: v.name, state: v.state, isDefault: v.is_default }));

/** The signed-in person's saved views of this report (never other people's). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    return jsonOk({ views: views(await listSavedViews(report.id, ctx.user.id)) });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/views");
  }
}

const saveSchema = z.object({
  name: z.string().trim().min(1).max(60),
  state: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().default(false),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = saveSchema.parse(await request.json());
    await saveView({
      reportId: report.id,
      userId: ctx.user.id,
      spec: report.spec,
      name: body.name,
      state: body.state,
      isDefault: body.isDefault,
    });
    return jsonOk({ views: views(await listSavedViews(report.id, ctx.user.id)) });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/views");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    await deleteView({ id, reportId: report.id, userId: ctx.user.id });
    return jsonOk({ views: views(await listSavedViews(report.id, ctx.user.id)) });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/[reportId]/views");
  }
}
