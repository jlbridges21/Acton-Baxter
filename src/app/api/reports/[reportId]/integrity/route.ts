import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { auditReportIntegrity } from "@/lib/reports/integrity";
import { getReportRaw, loadReportFor } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ reportId: string }> };

/** Read-only integrity audit of a saved report, run with the requester's own access. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const raw = await getReportRaw(report.id);
    return jsonOk(
      await auditReportIntegrity({ spec: report.spec, access: ctx.access, rawSpec: raw?.spec }),
    );
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/integrity");
  }
}
