"use client";

import { useState } from "react";
import type { ConnectorHealth } from "@/lib/connectors/types";
import type { GoogleSyncFolder } from "@/lib/connectors/google/types";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type GoogleConfig = {
  configured: boolean;
  projectIdPresent: boolean;
  clientEmail: string | null;
  privateKeyFormatValid: boolean;
  rootFolderConfigured: boolean;
  rootFolderRaw: string | null;
  privateKeyValidFormat?: boolean;
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  identityNote?: string;
};

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

export function GoogleConnectorClient({
  initialHealth,
  initialFolders,
  initialConfig,
  initialAuthenticated,
}: {
  initialHealth: ConnectorHealth;
  initialFolders: GoogleSyncFolder[];
  initialConfig: GoogleConfig;
  initialAuthenticated: boolean;
}) {
  const [health, setHealth] = useState(initialHealth);
  const [folders, setFolders] = useState(initialFolders);
  const [config, setConfig] = useState(initialConfig);
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagResult, setDiagResult] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/connectors/google");
    const payload = await response.json();
    if (response.ok) {
      setHealth(payload.health);
      setFolders(payload.folders);
      setConfig(payload.config);
      setAuthenticated(Boolean(payload.authenticated));
    }
  }

  async function runAction(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    setDiagResult(null);
    try {
      const response = await fetch("/api/admin/connectors/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Request failed");
      } else if (payload.result && payload.result.created !== undefined) {
        setMessage(
          `Sync finished: ${payload.result.created} created, ${payload.result.updated} updated, ${payload.result.unchanged} unchanged.`,
        );
      } else if (payload.result) {
        setDiagResult(JSON.stringify(payload.result, null, 2));
        setMessage("Diagnostic complete.");
      } else {
        setMessage("Saved.");
      }
      await refresh();
    } catch {
      setMessage("Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Google Workspace</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Google Docs and Sheets are the source of truth. Baxter syncs approved text into the
          Knowledge Base and always cites the original document.
        </p>
      </div>

      <Card>
        <CardTitle>Configuration</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            Project ID present: <YesNo value={config.projectIdPresent} />
          </div>
          <div>Client email: {config.clientEmail ?? "—"}</div>
          <div>
            Private key valid format: <YesNo value={config.privateKeyFormatValid} />
          </div>
          <div>
            Root folder configured: <YesNo value={config.rootFolderConfigured} />
          </div>
          <div>
            Authenticated: <YesNo value={authenticated} />
          </div>
          <div>
            Sync enabled: <YesNo value={Boolean(config.syncEnabled)} /> (
            {config.syncIntervalMinutes ?? 180} min)
          </div>
        </dl>
        <p className="mt-3 text-xs text-[var(--acton-muted)]">
          {config.identityNote ??
            "GOOGLE_CLIENT_EMAIL is the service-account principal. Sharing only with baxter@actonadu.com is not enough unless that address is the service account."}
        </p>
      </Card>

      <Card>
        <CardTitle>Connection status</CardTitle>
        <CardDescription className="mt-2">{health.details}</CardDescription>
        <dl className="mt-4 grid gap-2 text-sm text-[var(--acton-muted)] sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--acton-navy)]">Status</dt>
            <dd>{health.label}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--acton-navy)]">Indexed documents</dt>
            <dd>{health.itemsSynced ?? 0}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--acton-navy)]">Last sync</dt>
            <dd>{health.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--acton-navy)]">Last error</dt>
            <dd>{health.lastError ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runAction({ action: "test_auth" })}>
            Test authentication
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "test_root_folder" })}
          >
            Test root folder
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "list_sample_files" })}
          >
            List sample files
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "dry_run_sync" })}
          >
            Dry-run sync
          </Button>
          <Button disabled={busy} onClick={() => void runAction({ action: "sync" })}>
            Run real sync
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "test_google_through_baxter" })}
          >
            Test Google source through Baxter
          </Button>
        </div>
        {diagResult ? (
          <pre className="mt-4 overflow-x-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs">
            {diagResult}
          </pre>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Add Drive folder</CardTitle>
        <CardDescription className="mt-2">
          Share the folder with the service account email, then paste a folder ID or Drive folder
          URL.
        </CardDescription>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="Folder ID or https://drive.google.com/drive/folders/…"
            className="h-10 flex-1 rounded-md border border-[var(--acton-border)] px-3 text-sm"
          />
          <Button
            disabled={busy || !folderId.trim()}
            onClick={() =>
              void runAction({ action: "add_folder", folderId: folderId.trim() }).then(() =>
                setFolderId(""),
              )
            }
          >
            Add folder
          </Button>
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Connected folders</h2>
        {folders.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No folders connected yet.</p>
        ) : (
          folders.map((folder) => (
            <Card key={folder.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">{folder.folder_name}</CardTitle>
                  <CardDescription className="mt-1">
                    Status: {folder.status} · Indexed: {folder.indexed_document_count}
                    {folder.drive_id ? " · Shared Drive" : ""}
                  </CardDescription>
                  <p className="mt-2 text-xs text-[var(--acton-muted)]">
                    Last sync:{" "}
                    {folder.last_sync_at ? new Date(folder.last_sync_at).toLocaleString() : "Never"}
                  </p>
                  {folder.last_error ? (
                    <p className="mt-1 text-xs text-red-700">{folder.last_error}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void runAction({ action: "sync", id: folder.id })}
                  >
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void runAction({
                        action: folder.status === "paused" ? "resume" : "pause",
                        id: folder.id,
                      })
                    }
                  >
                    {folder.status === "paused" ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void runAction({ action: "remove_folder", id: folder.id })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {message ? <p className="text-sm text-[var(--acton-navy)]">{message}</p> : null}
    </div>
  );
}
