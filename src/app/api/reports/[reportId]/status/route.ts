import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { RESEARCH_STAGES } from "@/lib/research/constants";
import { getResearchStage } from "@/lib/research/run-property-research";
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

    const report = await getReportStore().getReport(reportId);
    if (!report) {
      throw new NotFoundError("Report not found");
    }

    const progress = getResearchStage(reportId, report.status);
    return jsonOk({
      reportId,
      status: report.status,
      stageIndex: progress.stageIndex,
      stageLabel: progress.stageLabel,
      stages: RESEARCH_STAGES,
      errorMessage: report.error_message,
      standardizedAddress: report.standardized_address,
      apn: report.apn,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/status");
  }
}
