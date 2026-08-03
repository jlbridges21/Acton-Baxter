import "server-only";

import { postSlackMessage } from "@/lib/slack/client";
import { getMonitoringSettings } from "./settings";
import {
  listFindings,
  markAlerted,
  markEscalated,
  claimOpenFindingForDelivery,
  releaseDeliveryClaim,
  reclaimAbandonedDeliveryClaims,
} from "./findings";
import { isInQuietHours } from "./quiet-hours";
import {
  formatFindingAlertText,
  formatFindingAlertBlocks,
  formatDigestSummaryText,
  formatEscalationText,
} from "./alerts";
import type { MonitoringFinding, MonitoringSettings } from "./types";

/**
 * Deliver pending alerts (called by baxter_alert_delivery job).
 */
export async function deliverPendingAlerts(): Promise<{
  delivered: number;
  escalated: number;
  skippedQuietHours: boolean;
}> {
  const settings = await getMonitoringSettings();
  const now = new Date();

  if (!settings.enabled) {
    return { delivered: 0, escalated: 0, skippedQuietHours: false };
  }

  if (!settings.pilot_slack_channel_id) {
    throw new Error("Monitoring Slack channel not configured");
  }

  const inQuietHours = isInQuietHours(now, settings);
  if (inQuietHours) {
    return { delivered: 0, escalated: 0, skippedQuietHours: true };
  }

  await reclaimAbandonedDeliveryClaims(10);

  const openFindings = await listFindings({ status: "open", limit: 100 });
  let delivered = 0;

  if (openFindings.length > 0) {
    if (settings.delivery_mode === "immediate") {
      delivered = await deliverImmediate(openFindings, settings.pilot_slack_channel_id);
    } else {
      delivered = await deliverDigest(openFindings, settings.pilot_slack_channel_id);
    }
  }

  const escalated = await handleEscalations(settings);

  return { delivered, escalated, skippedQuietHours: false };
}

async function deliverImmediate(
  openFindings: MonitoringFinding[],
  channelId: string,
): Promise<number> {
  let delivered = 0;

  for (const finding of openFindings) {
    const claimed = await claimOpenFindingForDelivery(finding.id);
    if (!claimed) {
      continue;
    }

    try {
      const text = formatFindingAlertText(claimed);
      const blocks = formatFindingAlertBlocks(claimed);

      const response = await postSlackMessage({
        channel: channelId,
        text,
        blocks,
      });

      if (response.ok && response.ts) {
        // Root alert ts is the thread parent for later escalations.
        await markAlerted(claimed.id, {
          channelId,
          messageTs: response.ts,
          threadTs: response.ts,
        });
        delivered += 1;
      } else {
        await releaseDeliveryClaim(claimed.id);
      }
    } catch (error) {
      await releaseDeliveryClaim(claimed.id);
      throw error;
    }
  }

  return delivered;
}

async function deliverDigest(
  openFindings: MonitoringFinding[],
  channelId: string,
): Promise<number> {
  const claimed: MonitoringFinding[] = [];
  for (const finding of openFindings) {
    const next = await claimOpenFindingForDelivery(finding.id);
    if (next) claimed.push(next);
  }

  if (claimed.length === 0) {
    return 0;
  }

  try {
    const text = formatDigestSummaryText(claimed);
    const blocks: unknown[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
      {
        type: "divider",
      },
    ];

    for (const finding of claimed.slice(0, 10)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: formatFindingAlertText(finding),
        },
      });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Finding ID: \`${finding.id}\` | Severity: ${finding.severity} | Check: ${finding.check_key}`,
          },
        ],
      });
    }

    if (claimed.length > 10) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `...and ${claimed.length - 10} more findings`,
          },
        ],
      });
    }

    const response = await postSlackMessage({
      channel: channelId,
      text,
      blocks,
    });

    if (response.ok && response.ts) {
      for (const finding of claimed) {
        await markAlerted(finding.id, {
          channelId,
          messageTs: response.ts,
          threadTs: response.ts,
        });
      }
      return claimed.length;
    }

    for (const finding of claimed) {
      await releaseDeliveryClaim(finding.id);
    }
    return 0;
  } catch (error) {
    for (const finding of claimed) {
      await releaseDeliveryClaim(finding.id);
    }
    throw error;
  }
}

/**
 * Handle escalations for alerted findings past the escalation window.
 * Exported for unit tests.
 */
export async function handleEscalations(settings: MonitoringSettings): Promise<number> {
  const escalationCutoff = new Date(
    Date.now() - settings.escalation_window_minutes * 60 * 1000,
  ).toISOString();

  const alertedFindings = await listFindings({ status: "alerted", limit: 100 });

  const toEscalate = alertedFindings.filter(
    (f) => f.alerted_at && f.alerted_at < escalationCutoff && !f.escalated_at,
  );

  let escalated = 0;

  for (const finding of toEscalate) {
    if (!finding.slack_channel_id || !finding.slack_message_ts || !finding.slack_thread_ts) {
      continue;
    }

    const text = formatEscalationText(finding);

    await postSlackMessage({
      channel: finding.slack_channel_id,
      threadTs: finding.slack_thread_ts,
      text,
    });

    await markEscalated(finding.id);
    escalated += 1;
  }

  return escalated;
}
