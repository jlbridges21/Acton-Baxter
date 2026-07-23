import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { runPropertyResearch } from "@/lib/research/run-property-research";
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

    // Fire-and-forget so the user can navigate away while research continues.
    void runPropertyResearch(reportId).catch((error) => {
      console.error("[run] background research failed", error);
    });

    return jsonOk({ reportId, status: "researching", started: true });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/run");
  }
}
