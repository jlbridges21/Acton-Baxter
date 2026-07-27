import "server-only";

import { enqueueJob } from "@/lib/jobs/queue";
import { isMonitoringEnabled } from "@/lib/monitoring/settings";

/**
 * On Vercel cron (currently daily), enqueue a monitor sweep when monitoring is enabled.
 * Does not invent a higher-frequency schedule than the deployment provides.
 */
export async function maybeEnqueueScheduledMonitoringSweep(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  try {
    const enabled = await isMonitoringEnabled();
    if (!enabled) {
      return { enqueued: false, reason: "monitoring_disabled" };
    }

    await enqueueJob({
      reportId: null,
      jobType: "baxter_monitor_sweep",
      metadata: { source: "scheduled" },
    });
    return { enqueued: true, reason: "enqueued" };
  } catch (error) {
    console.error("Failed to enqueue monitoring sweep:", error);
    return { enqueued: false, reason: "error" };
  }
}
