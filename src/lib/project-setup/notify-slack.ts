import "server-only";

import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { postSlackMessage } from "@/lib/slack/client";
import { openSlackDm } from "@/lib/slack/provisioning";
import { getProjectSetupRun, getProjectSetupSteps } from "./store";

/**
 * DM the Slack initiator when a /new-project run finishes or fails.
 * Never throws — notifications must not fail the job.
 */
export async function notifyProjectSetupSlackInitiator(
  runId: string,
  result: { status: "complete" | "failed"; error?: string },
): Promise<void> {
  try {
    const run = await getProjectSetupRun(runId);
    if (!run?.slackInitiatorId) return;

    const base = getPublicAppBaseUrl();
    const runUrl = `${base}/projects/setup/${runId}`;
    const steps = await getProjectSetupSteps(runId);

    let text: string;
    if (result.status === "failed") {
      text = [
        `Project setup failed for ${run.projectNumber ?? "new project"} — ${run.projectLastName ?? ""}.`,
        result.error ? `Error: ${result.error}` : null,
        `Retry: ${runUrl}`,
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      const folder = steps.find((s) => s.stepKey === "copy_template_folder");
      const charter = steps.find((s) => s.stepKey === "copy_charter_spreadsheet");
      const channel = steps.find((s) => s.stepKey === "create_slack_channel");
      const folderLink =
        typeof folder?.outputJson.webViewLink === "string" ? folder.outputJson.webViewLink : null;
      const charterLink =
        typeof charter?.outputJson.webViewLink === "string" ? charter.outputJson.webViewLink : null;
      const channelId =
        typeof channel?.outputJson.channelId === "string" ? channel.outputJson.channelId : null;
      const channelName = run.slackChannelName ?? "channel";

      text = [
        run.dryRun
          ? `Dry-run complete for ${run.projectNumber} — ${run.projectLastName}. No external systems were changed.`
          : `Project setup complete for ${run.projectNumber} — ${run.projectLastName}.`,
        channelId ? `• Slack: <#${channelId}>` : `• Slack channel: #${channelName}`,
        folderLink ? `• Drive folder: <${folderLink}|${run.folderName}>` : null,
        charterLink ? `• Charter: <${charterLink}|${run.charterName}>` : null,
        `Details: ${runUrl}`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    const dm = await openSlackDm(run.slackInitiatorId);
    await postSlackMessage({ channel: dm.channelId, text });
  } catch (error) {
    console.error("[project-setup] slack initiator notify failed", error);
  }
}
