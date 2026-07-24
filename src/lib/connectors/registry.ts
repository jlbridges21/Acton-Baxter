import "server-only";

import type { ConnectorHealth, KnowledgeConnector } from "./types";
import { GoogleWorkspaceConnector } from "./google/sync";
import { SlackConnectorHealth } from "./slack/health";

const FUTURE: Array<{ key: ConnectorHealth["key"]; name: string }> = [
  { key: "gohighlevel", name: "GoHighLevel" },
  { key: "buildertrend", name: "Buildertrend" },
  { key: "domo", name: "Domo" },
];

export function getGoogleConnector(): KnowledgeConnector {
  return new GoogleWorkspaceConnector();
}

export async function listConnectorHealth(): Promise<ConnectorHealth[]> {
  const google = await getGoogleConnector().health();
  const slack = await SlackConnectorHealth();
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
  return [google, slack, ...future];
}
