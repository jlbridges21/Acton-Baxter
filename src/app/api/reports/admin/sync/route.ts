import { after } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { ensureEntityStates, getSyncManagerOverview } from "@/lib/jobtread/sync-manager";
import { requireReportsAdmin } from "@/lib/reports/http";
import { applySyncAction, kickSyncJob, syncActionSchema } from "@/lib/reports/sync-http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sync Manager: per-dataset inventory, status, schedule, and run history. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await getSyncManagerOverview());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/sync");
  }
}

/** Sync, retry, enable/disable, or schedule datasets. Returns real run and job ids. */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const action = syncActionSchema.parse(await request.json());
    const outcome = await applySyncAction(
      action,
      { userId: ctx.user.id, label: ctx.requester.label },
      async () => (await ensureEntityStates()).filter((s) => s.enabled).map((s) => s.entity),
    );
    const jobId = outcome.request?.jobId ?? null;
    if (jobId) after(() => kickSyncJob(jobId).catch(() => undefined));
    return jsonOk({ ...(await getSyncManagerOverview()), outcome });
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/sync");
  }
}
