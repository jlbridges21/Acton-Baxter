import { jsonError, jsonOk } from "@/lib/api";
import { AuthenticationError } from "@/lib/errors";
import { processQueuedJobs } from "@/lib/jobs/process";
import { maybeEnqueueScheduledGoogleSync } from "@/lib/connectors/google/schedule";
import { authorizeCronBearer } from "@/lib/jobs/cron-auth";
import { recordCronInvocation } from "@/lib/jobs/cron-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = authorizeCronBearer(request);
    if (!auth.ok) {
      recordCronInvocation({ ok: false, code: auth.code });
      throw new AuthenticationError(
        auth.code === "BAXTER_CRON_SECRET_MISSING"
          ? "Cron secret is not configured"
          : "Invalid cron secret",
        { code: auth.code ?? "BAXTER_CRON_UNAUTHORIZED" },
      );
    }

    const scheduled = await maybeEnqueueScheduledGoogleSync();
    const result = await processQueuedJobs({ limit: 10 });
    recordCronInvocation({ ok: true, code: null });
    return jsonOk({ ...result, googleSync: scheduled });
  } catch (error) {
    return jsonError(error, "POST /api/internal/process-jobs");
  }
}

export async function GET(request: Request) {
  return POST(request);
}
