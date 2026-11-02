import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { requireReportsContext } from "@/lib/reports/http";
import { projectFinancialDrill } from "@/lib/reports/pp-mapping";

export const dynamic = "force-dynamic";

/** Project → PP# milestone → invoice → payments (financial access required). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    if (!ctx.access.categories.has("financial"))
      throw new AuthorizationError("Invoices and payments need financial access in Reports.");
    const jobId = new URL(request.url).searchParams.get("jobId")?.slice(0, 80);
    if (!jobId) throw new ValidationError("Pass ?jobId=");
    return jsonOk(await projectFinancialDrill(jobId));
  } catch (error) {
    return jsonError(error, "GET /api/reports/financial/drill");
  }
}
