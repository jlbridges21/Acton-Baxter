import "server-only";

import type { ConnectorHealth, KnowledgeConnector } from "./types";
import { GoogleWorkspaceConnector } from "./google/sync";
import { SlackConnectorHealth } from "./slack/health";
import { GhlConnectorHealth } from "./ghl/health";

const FUTURE: Array<{ key: ConnectorHealth["key"]; name: string }> = [
  { key: "buildertrend", name: "Buildertrend" },
  { key: "domo", name: "Domo" },
];

export function getGoogleConnector(): KnowledgeConnector {
  return new GoogleWorkspaceConnector();
}

export async function listConnectorHealth(): Promise<ConnectorHealth[]> {
  const [google, slack, ghl] = await Promise.all([
    getGoogleConnector().health(),
    SlackConnectorHealth(),
    GhlConnectorHealth(),
  ]);
  const future: ConnectorHealth[] = FUTURE.map((item) => ({
    key: item.key,
    name: item.name,
    status: "coming_soon",
    label: "Coming Soon",
    lastSyncAt: null,
    lastError: null,
    itemsSynced: null,
    details: "Not implemented in this release.",
  }));
  return [google, slack, ghl, ...future];
}
