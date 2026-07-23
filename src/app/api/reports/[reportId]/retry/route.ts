import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { retryPropertyResearch } from "@/lib/research/run-property-research";
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

    // Retry runs in the background so the UI can return to the processing page.
    void retryPropertyResearch(reportId).catch((error) => {
      console.error("[retry] failed", error);
    });

    return jsonOk({ reportId, status: "queued" });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/retry");
  }
}
