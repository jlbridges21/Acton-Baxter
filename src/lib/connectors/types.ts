export type ConnectorKey = "google_workspace" | "slack" | "gohighlevel" | "buildertrend" | "domo";

export type ConnectorHealthStatus = "healthy" | "warning" | "offline" | "coming_soon";

export type ConnectorHealth = {
  key: ConnectorKey;
  name: string;
  status: ConnectorHealthStatus;
  label: string;
  lastSyncAt: string | null;
  lastError: string | null;
  itemsSynced: number | null;
  details?: string | null;
};

export type ConnectorSyncResult = {
  connector: ConnectorKey;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
  archived?: number;
  runId?: string;
};

export interface KnowledgeConnector {
  readonly key: ConnectorKey;
  readonly name: string;
  health(): Promise<ConnectorHealth>;
  listSources(): Promise<Array<{ id: string; name: string; status: string }>>;
  sync(options?: {
    folderId?: string;
    triggerSource?: "manual" | "cron" | "retry" | "admin";
    jobId?: string | null;
  }): Promise<ConnectorSyncResult>;
}
