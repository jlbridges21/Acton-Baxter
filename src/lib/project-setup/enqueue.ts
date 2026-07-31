import "server-only";

import { after } from "next/server";
import { enqueueJob, usesMemoryJobStore } from "@/lib/jobs/queue";
import { runProjectSetupJob } from "./runner";

export async function enqueueProjectSetupRun(runId: string): Promise<{ jobId: string }> {
  const job = await enqueueJob({
    reportId: null,
    jobType: "project_setup",
    metadata: { projectSetupRunId: runId },
  });

  const run = async () => {
    try {
      await runProjectSetupJob(runId);
    } catch (error) {
      console.error("[project-setup] job failed", error);
    }
  };

  if (usesMemoryJobStore()) {
    await run();
  } else {
    after(run);
  }

  return { jobId: job.id };
}
