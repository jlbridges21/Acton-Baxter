import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireUser();
    const { reportId } = await context.params;
    if (!isUuid(reportId)) {
      throw new ValidationError("Invalid report id");
    }

    const report = await getReportStore().getFullReport(reportId);
    if (!report) {
      throw new NotFoundError("Report not found");
    }

    return jsonOk({ report });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]");
  }
}
