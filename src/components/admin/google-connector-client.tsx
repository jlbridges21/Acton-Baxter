"use client";

import { useState } from "react";
import type { ConnectorHealth } from "@/lib/connectors/types";
import type { GoogleSyncFolder } from "@/lib/connectors/google/types";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function GoogleConnectorClient({
  initialHealth,
  initialFolders,
}: {
  initialHealth: ConnectorHealth;
  initialFolders: GoogleSyncFolder[];
}) {
  const [health, setHealth] = useState(initialHealth);
  const [folders, setFolders] = useState(initialFolders);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/connectors/google");
    const payload = await response.json();
    if (response.ok) {
      setHealth(payload.health);
      setFolders(payload.folders);
    }
  }

  async function runAction(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/connectors/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Request failed");
      } else if (payload.result) {
        setMessage(
          `Sync finished: ${payload.result.created} created, ${payload.result.updated} updated, ${payload.result.unchanged} unchanged.`,
        );
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
        <div className="mt-4">
          <Button disabled={busy} onClick={() => void runAction({ action: "sync" })}>
            Run sync now
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Add Drive folder</CardTitle>
        <CardDescription className="mt-2">
          Share the folder with the Baxter service account, then paste the folder ID.
        </CardDescription>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="Google Drive folder ID"
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
                  </CardDescription>
                  <p className="mt-2 text-xs text-[var(--acton-muted)]">
                    Last sync:{" "}
                    {folder.last_sync_at ? new Date(folder.last_sync_at).toLocaleString() : "Never"}
                    {folder.last_modified_seen_at
                      ? ` · Last modified seen: ${new Date(folder.last_modified_seen_at).toLocaleString()}`
                      : ""}
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
