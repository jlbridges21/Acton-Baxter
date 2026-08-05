import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { enqueuePropertyResearch } from "@/lib/research/enqueue";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireActiveUser();
    const { reportId } = await context.params;
    if (!isUuid(reportId)) {
      throw new ValidationError("Invalid report id");
    }

    const store = getReportStore();
    const report = await store.getReport(reportId);
    if (!report) throw new NotFoundError("Report not found");

    await store.clearResearchChildren(reportId);
    await store.updateReportStatus(reportId, "queued", {
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    });

    const { jobId } = await enqueuePropertyResearch(reportId, { source: "web_retry" });

    return jsonOk({ reportId, status: "queued", jobId });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/retry");
  }
}
