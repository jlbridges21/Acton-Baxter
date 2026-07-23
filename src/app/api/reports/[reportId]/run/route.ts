import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { runPropertyResearch } from "@/lib/research/run-property-research";
import { isUuid } from "@/lib/utils";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    await requireUser();
    const { reportId } = await context.params;
    if (!isUuid(reportId)) {
      throw new ValidationError("Invalid report id");
    }

    await runPropertyResearch(reportId);
    const report = await (
      await import("@/lib/research/report-store")
    )
      .getReportStore()
      .getReport(reportId);
    return jsonOk({ reportId, status: report?.status ?? "researching" });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/run");
  }
}
