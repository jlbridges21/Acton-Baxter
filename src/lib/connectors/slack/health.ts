import "server-only";

import { evaluateSlackHealth } from "@/lib/slack/config";
import type { ConnectorHealth } from "../types";

function mapStatus(status: string): ConnectorHealth["status"] {
  switch (status) {
    case "ready":
      return "healthy";
    case "warning":
    case "misconfigured":
      return "warning";
    case "disabled":
    case "offline":
    default:
      return "offline";
  }
}

export async function SlackConnectorHealth(): Promise<ConnectorHealth> {
  try {
    // Config-only check here (no live auth.test) so the connectors page stays fast.
    // /admin/slack runs auth.test on demand via diagnostic actions.
    const health = await evaluateSlackHealth();
    return {
      key: "slack",
      name: "Slack",
      status: mapStatus(health.status),
      label: health.label,
      lastSyncAt: null,
      lastError: health.authError,
      itemsSynced: null,
      details: health.details,
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
