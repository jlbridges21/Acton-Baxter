import { jsonError, jsonOk } from "@/lib/api";
import { financialOverview, isFieldErrors, runFinancialAction } from "@/lib/reports/financial-http";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Financial data readiness, status mapping, PP# mapping, snapshots, and alerts. Admins only. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await financialOverview());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/financial");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const result = await runFinancialAction(ctx, await request.json().catch(() => null));
    // Validation problems come back with their field paths so the editor can show each one.
    return jsonOk(result, isFieldErrors(result) ? { status: 422 } : undefined);
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/financial");
  }
}
