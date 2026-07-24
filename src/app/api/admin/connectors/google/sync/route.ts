import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { enqueueOrRunGoogleSync } from "@/lib/connectors/google/sync";
import { claimJobById } from "@/lib/jobs/queue";
import { processJob } from "@/lib/jobs/process";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({
        rootId: z.string().uuid().optional().nullable(),
        processImmediately: z.boolean().optional().default(true),
      })
      .parse(body ?? {});

    const enqueued = await enqueueOrRunGoogleSync({
      userId: user.id,
      rootId: parsed.rootId,
      runInline: false,
    });

    if (parsed.processImmediately && enqueued.jobId) {
      const job = await claimJobById(enqueued.jobId);
      if (job) {
        const outcome = await processJob(job);
        return jsonOk({
          jobId: enqueued.jobId,
          status: outcome,
          message:
            "Google sync processed. The internal /api/internal/process-jobs route remains cron-protected.",
        });
      }
    }

    return jsonOk({
      jobId: enqueued.jobId,
      status: enqueued.status,
      message: "Google sync job queued. Cron or Process pending job will run it.",
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google/sync");
  }
}
