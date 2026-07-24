import "server-only";

import { getEnv } from "@/lib/env";
import type { ConnectorHealth } from "../types";

export async function SlackConnectorHealth(): Promise<ConnectorHealth> {
  try {
    const env = getEnv();
    const enabled = env.ENABLE_SLACK_INTEGRATION;
    const configured = Boolean(
      env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET && env.SLACK_ALLOWED_TEAM_IDS,
    );

    if (!enabled) {
      return {
        key: "slack",
        name: "Slack",
        status: "offline",
        label: "Offline",
        lastSyncAt: null,
        lastError: null,
        itemsSynced: null,
        details: "ENABLE_SLACK_INTEGRATION is false.",
      };
    }

    if (!configured) {
      return {
        key: "slack",
        name: "Slack",
        status: "warning",
        label: "Warning",
        lastSyncAt: null,
        lastError: "Missing Slack bot token, signing secret, or allowed team IDs.",
        itemsSynced: null,
        details: "Slack integration is enabled but incomplete.",
      };
    }

    return {
      key: "slack",
      name: "Slack",
      status: "healthy",
      label: "Healthy",
      lastSyncAt: null,
      lastError: null,
      itemsSynced: null,
      details: "Events API + /property slash command ready when endpoints are configured.",
    };
  } catch {
    return {
      key: "slack",
      name: "Slack",
      status: "offline",
      label: "Offline",
      lastSyncAt: null,
      lastError: "Environment is not available.",
      itemsSynced: null,
    };
  }
}
