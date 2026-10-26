import { jsonError, jsonOk } from "@/lib/api";
import { getDataHealthDashboard } from "@/lib/reports/data-health";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

/** Data Health: dataset freshness, reports affected, and mapping/governance gaps. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await getDataHealthDashboard());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/health");
  }
}
