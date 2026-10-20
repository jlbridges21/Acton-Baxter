import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { listExpenseJobs } from "@/lib/receipts";

/**
 * Employee dropdown: Open projects plus active custom jobs. Reads expense_jobs
 * only (no Google).
 */
export async function GET() {
  try {
    await requireActiveUser();
    const jobs = await listExpenseJobs({ includeInactive: false });
    return jsonOk({ jobs });
  } catch (error) {
    return jsonError(error, "GET /api/receipts/jobs");
  }
}
