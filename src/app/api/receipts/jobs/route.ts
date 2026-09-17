import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { listExpenseJobs, syncExpenseJobsFromMasterProjectLog } from "@/lib/receipts";

/** Active jobs for the employee dropdown (syncs Master Project Log on read). */
export async function GET() {
  try {
    await requireActiveUser();
    await syncExpenseJobsFromMasterProjectLog();
    const jobs = await listExpenseJobs({ includeInactive: false });
    return jsonOk({ jobs });
  } catch (error) {
    return jsonError(error, "GET /api/receipts/jobs");
  }
}
