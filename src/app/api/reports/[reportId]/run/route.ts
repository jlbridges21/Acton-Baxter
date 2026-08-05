import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { enqueuePropertyResearch } from "@/lib/research/enqueue";
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

    const { jobId } = await enqueuePropertyResearch(reportId, { source: "web" });

    return jsonOk({ reportId, status: "researching", started: true, jobId });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/run");
  }
}
