import "server-only";

import { postSlackMessage } from "@/lib/slack/client";
import { getMonitoringSettings } from "./settings";
import { listFindings, markAlerted, markEscalated } from "./findings";
import { isInQuietHours } from "./quiet-hours";
import {
  formatFindingAlertText,
  formatFindingAlertBlocks,
  formatDigestSummaryText,
  formatEscalationText,
} from "./alerts";
import type { MonitoringSettings } from "./types";

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

  const openFindings = await listFindings({ status: "open", limit: 100 });

  if (openFindings.length === 0) {
    return { delivered: 0, escalated: 0, skippedQuietHours: false };
  }

  let delivered = 0;

  if (settings.delivery_mode === "immediate") {
    for (const finding of openFindings) {
      const text = formatFindingAlertText(finding);
      const blocks = formatFindingAlertBlocks(finding);

      const response = await postSlackMessage({
        channel: settings.pilot_slack_channel_id,
        text,
        blocks,
      });

      if (response.ok && response.ts) {
        await markAlerted(finding.id, {
          channelId: settings.pilot_slack_channel_id,
          messageTs: response.ts,
        });
        delivered += 1;
      }
    }
  } else {
    const text = formatDigestSummaryText(openFindings);
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

    for (const finding of openFindings.slice(0, 10)) {
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

    if (openFindings.length > 10) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `...and ${openFindings.length - 10} more findings`,
          },
        ],
      });
    }

    const response = await postSlackMessage({
      channel: settings.pilot_slack_channel_id,
      text,
      blocks,
    });

    if (response.ok && response.ts) {
      for (const finding of openFindings) {
        await markAlerted(finding.id, {
          channelId: settings.pilot_slack_channel_id,
          messageTs: response.ts,
        });
      }
      delivered = openFindings.length;
    }
  }

  const escalated = await handleEscalations(settings);

  return { delivered, escalated, skippedQuietHours: false };
}

/**
 * Handle escalations for alerted findings past the escalation window.
 */
async function handleEscalations(settings: MonitoringSettings): Promise<number> {
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
      threadTs: finding.slack_message_ts,
      text,
    });

    await markEscalated(finding.id);
    escalated += 1;
  }

  return escalated;
}
