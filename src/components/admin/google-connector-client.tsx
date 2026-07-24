"use client";

import { useCallback, useMemo, useState } from "react";
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

type ManagerHealth = { state: string; label: string; details: string };

type BrowseItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime: string | null;
  webViewLink: string | null;
  owner: string | null;
  driveId: string | null;
  supported: boolean;
  parseModeHint: string;
};

type Selection = {
  id: string;
  root_id: string;
  google_file_id: string;
  selection_type: "file" | "folder";
  recursive: boolean;
  include_future_files: boolean;
  explicitly_excluded: boolean;
  enabled: boolean;
  title_snapshot: string | null;
};

type SyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger_source: string;
  files_discovered: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  archived_count: number;
  failed_count: number;
  duration_ms: number | null;
  error_summary: string | null;
};

type SyncedStats = {
  synced: number;
  failed: number;
  excluded: number;
  unsupported: number;
  accessLost: number;
  pending: number;
};

type CronInfo = {
  cronSecretConfigured: boolean;
  canonicalVariable: string | null;
  routeRegistered: boolean;
  schedule: string | null;
  note: string;
  lastCronInvocation: string | null;
  lastSuccessfulJobProcessingRun: string | null;
  lastFailedJobProcessingRun: string | null;
};

type WizardStep = {
  key: string;
  title: string;
  status: "complete" | "needs_attention" | "failed" | "pending";
};

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
      {value ? "Yes" : "No"}
    </span>
  );
}

function mimeLabel(mime: string, isFolder: boolean) {
  if (isFolder) return "Folder";
  if (mime.includes("document")) return "Google Doc";
  if (mime.includes("spreadsheet")) return "Google Sheet";
  if (mime === "application/pdf") return "PDF (metadata only)";
  if (mime.includes("wordprocessingml")) return "Word (metadata only)";
  if (mime.startsWith("text/")) return "Text";
  return "File";
}

function selectionStatus(
  item: BrowseItem,
  selections: Selection[],
): "directly_selected" | "excluded" | "not_selected" | "unsupported" {
  if (!item.isFolder && !item.supported && item.parseModeHint === "unsupported") {
    return "unsupported";
  }
  const match = selections.find((s) => s.google_file_id === item.id && s.enabled);
  if (!match) return "not_selected";
  if (match.explicitly_excluded) return "excluded";
  return "directly_selected";
}

export function GoogleConnectorClient({
  initialHealth,
  initialFolders,
  initialConfig,
  initialAuthenticated,
  initialManagerHealth,
}: {
  initialHealth: ConnectorHealth;
  initialFolders: GoogleSyncFolder[];
  initialConfig: GoogleConfig;
  initialAuthenticated: boolean;
  initialManagerHealth?: ManagerHealth;
}) {
  const [health, setHealth] = useState(initialHealth);
  const [managerHealth, setManagerHealth] = useState<ManagerHealth>(
    initialManagerHealth ?? {
      state: "not_configured",
      label: health.label,
      details: health.details ?? "",
    },
  );
  const [folders, setFolders] = useState(initialFolders);
  const [config, setConfig] = useState(initialConfig);
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [syncedStats, setSyncedStats] = useState<SyncedStats | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [cron, setCron] = useState<CronInfo | null>(null);
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagResult, setDiagResult] = useState<string | null>(null);

  const [browseRootId, setBrowseRootId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [accessWarning, setAccessWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "modified">("name");
  const [fileType, setFileType] = useState<"all" | "docs" | "sheets" | "folders" | "supported">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const activeRoot = useMemo(
    () => folders.find((f) => f.id === browseRootId) ?? folders.find((f) => f.status === "active"),
    [folders, browseRootId],
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/connectors/google");
    const payload = await response.json();
    if (response.ok) {
      setHealth(payload.health);
      setManagerHealth(payload.managerHealth ?? managerHealth);
      setFolders(payload.folders);
      setConfig(payload.config);
      setAuthenticated(Boolean(payload.authenticated));
      setSelections(payload.selections ?? []);
      setSyncedStats(payload.syncedStats ?? null);
      setRuns(payload.runs ?? []);
      setCron(payload.cron ?? null);
    }
  }, [managerHealth]);

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
        return payload;
      }
      if (payload.result && payload.result.created !== undefined) {
        setMessage(
          `Sync finished: ${payload.result.created} created, ${payload.result.updated} updated, ${payload.result.unchanged} unchanged.`,
        );
      } else if (payload.result) {
        setDiagResult(JSON.stringify(payload.result, null, 2));
        if (payload.result.items) {
          setItems(payload.result.items);
          setBreadcrumbs(payload.result.breadcrumbs ?? []);
          setCurrentFolderId(payload.result.currentFolderId);
          setAccessWarning(payload.result.accessWarning ?? null);
          if (payload.result.rootId) setBrowseRootId(payload.result.rootId);
          if (payload.result.selections) setSelections(payload.result.selections);
        }
        if (payload.result.previewText !== undefined) {
          setPreview(JSON.stringify(payload.result, null, 2));
        }
        setMessage("Done.");
      } else if (payload.jobId) {
        setMessage(`Job ${payload.jobId}: ${payload.status ?? "queued"}`);
      } else {
        setMessage("Saved.");
      }
      await refresh();
      return payload;
    } catch {
      setMessage("Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runSyncNow() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/connectors/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootId: activeRoot?.id ?? null,
          processImmediately: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Sync failed");
      } else {
        setMessage(
          payload.message ??
            `Sync ${payload.status}${payload.jobId ? ` (job ${payload.jobId})` : ""}`,
        );
      }
      await refresh();
    } catch {
      setMessage("Sync request failed");
    } finally {
      setBusy(false);
    }
  }

  async function browse(folderIdOverride?: string | null) {
    await runAction({
      action: "browse",
      rootId: activeRoot?.id,
      currentFolderId: folderIdOverride ?? currentFolderId ?? undefined,
      search: search || undefined,
      sort,
      fileType,
    });
  }

  const wizardSteps: WizardStep[] = useMemo(() => {
    const steps: WizardStep[] = [
      {
        key: "credentials",
        title: "Credentials",
        status: authenticated ? "complete" : config.configured ? "failed" : "needs_attention",
      },
      {
        key: "apis",
        title: "APIs",
        status: authenticated ? "complete" : "needs_attention",
      },
      {
        key: "root",
        title: "Root folder",
        status: folders.length > 0 || config.rootFolderConfigured ? "complete" : "needs_attention",
      },
      {
        key: "access",
        title: "Access",
        status: items.length > 0 || folders.length > 0 ? "complete" : "needs_attention",
      },
      {
        key: "select",
        title: "Select sources",
        status: selections.some((s) => !s.explicitly_excluded) ? "complete" : "needs_attention",
      },
      {
        key: "preview",
        title: "Preview",
        status: preview ? "complete" : "pending",
      },
      {
        key: "sync",
        title: "Initial sync",
        status: (syncedStats?.synced ?? 0) > 0 ? "complete" : "pending",
      },
      {
        key: "baxter",
        title: "Baxter test",
        status: "pending",
      },
      {
        key: "auto",
        title: "Automatic sync",
        status: cron?.cronSecretConfigured && cron.routeRegistered ? "complete" : "needs_attention",
      },
    ];
    return steps;
  }, [authenticated, config, folders.length, items.length, selections, preview, syncedStats, cron]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedItems = items.filter((item) => selectedIds.has(item.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">
          Google Drive Knowledge Manager
        </h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Browse Acton Drive folders, select what Baxter may use, preview imports, and sync into the
          approved Knowledge Base. Google remains read-only.
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50/60">
        <CardTitle className="text-base">Cron route note</CardTitle>
        <p className="mt-2 text-sm text-[var(--acton-muted)]">
          The internal <code className="text-xs">/api/internal/process-jobs</code> route is
          intentionally protected. Opening it directly in a browser will return an authentication
          error. Use <strong>Run sync now</strong> here, or let Vercel Cron call it automatically
          with a Bearer secret.
        </p>
      </Card>

      <Card>
        <CardTitle>Setup checklist</CardTitle>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {wizardSteps.map((step, index) => (
            <li
              key={step.key}
              className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm"
            >
              <div className="font-medium text-[var(--acton-navy)]">
                {index + 1}. {step.title}
              </div>
              <div
                className={
                  step.status === "complete"
                    ? "text-emerald-700"
                    : step.status === "failed"
                      ? "text-red-700"
                      : "text-amber-700"
                }
              >
                {step.status.replace("_", " ")}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardDescription>Connector health</CardDescription>
          <CardTitle className="mt-1 text-lg">{managerHealth.label}</CardTitle>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">{managerHealth.details}</p>
        </Card>
        <Card>
          <CardDescription>Selected</CardDescription>
          <CardTitle className="mt-1 text-lg">
            {selections.filter((s) => !s.explicitly_excluded).length}
          </CardTitle>
        </Card>
        <Card>
          <CardDescription>Synced / failed</CardDescription>
          <CardTitle className="mt-1 text-lg">
            {syncedStats?.synced ?? 0} / {syncedStats?.failed ?? 0}
          </CardTitle>
        </Card>
        <Card>
          <CardDescription>Last automatic sync hint</CardDescription>
          <CardTitle className="mt-1 text-base">
            {cron?.lastSuccessfulJobProcessingRun
              ? new Date(cron.lastSuccessfulJobProcessingRun).toLocaleString()
              : "No cron run yet"}
          </CardTitle>
        </Card>
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
            {config.syncIntervalMinutes ?? 180} min due logic)
          </div>
          <div>
            Cron secret configured: <YesNo value={Boolean(cron?.cronSecretConfigured)} />
          </div>
          <div>Canonical cron var: {cron?.canonicalVariable ?? "—"}</div>
          <div>Cron schedule: {cron?.schedule ?? "—"}</div>
        </dl>
        <p className="mt-3 text-xs text-[var(--acton-muted)]">
          Google API access is performed by <strong>GOOGLE_CLIENT_EMAIL</strong>. Ensure the
          selected folder or Shared Drive is shared with that service-account address unless
          domain-wide delegation is configured.
        </p>
      </Card>

      <Card>
        <CardTitle>Safe tests & sync</CardTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runAction({ action: "test_auth" })}>
            Test credentials
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
          <Button disabled={busy} variant="secondary" onClick={() => void browse()}>
            Browse files
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "dry_run_sync" })}
          >
            Dry-run sync
          </Button>
          <Button disabled={busy} onClick={() => void runSyncNow()}>
            Run sync now
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "process_one_job" })}
          >
            Process pending job now
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "test_google_through_baxter" })}
          >
            Test through Baxter
          </Button>
        </div>
        {diagResult ? (
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs">
            {diagResult}
          </pre>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Connect Drive root</CardTitle>
        <CardDescription className="mt-2">
          Paste a folder ID or full Drive folder URL. Shared Drive folders are supported when shared
          with the service account.
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
        <div className="mt-4 space-y-2">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex flex-col gap-2 rounded-md border border-[var(--acton-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium text-[var(--acton-navy)]">{folder.folder_name}</div>
                <div className="text-xs text-[var(--acton-muted)]">
                  {folder.status}
                  {folder.drive_id ? " · Shared Drive" : " · My Drive / folder"} · indexed{" "}
                  {folder.indexed_document_count}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setBrowseRootId(folder.id);
                    void runAction({
                      action: "browse",
                      rootId: folder.id,
                      sort,
                      fileType,
                    });
                  }}
                >
                  Open browser
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
                  Disconnect root
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Drive browser</CardTitle>
        <CardDescription className="mt-2">
          Select files or folders Baxter is allowed to use. Nothing syncs until you add it to Baxter
          and run sync.
        </CardDescription>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search in current folder"
            className="h-10 min-w-[12rem] flex-1 rounded-md border border-[var(--acton-border)] px-3 text-sm"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "name" | "modified")}
            className="h-10 rounded-md border border-[var(--acton-border)] px-2 text-sm"
          >
            <option value="name">Sort by name</option>
            <option value="modified">Sort by modified</option>
          </select>
          <select
            value={fileType}
            onChange={(e) =>
              setFileType(e.target.value as "all" | "docs" | "sheets" | "folders" | "supported")
            }
            className="h-10 rounded-md border border-[var(--acton-border)] px-2 text-sm"
          >
            <option value="all">All types</option>
            <option value="folders">Folders</option>
            <option value="docs">Docs</option>
            <option value="sheets">Sheets</option>
            <option value="supported">Supported content</option>
          </select>
          <Button disabled={busy || !activeRoot} onClick={() => void browse()}>
            Refresh
          </Button>
        </div>

        {breadcrumbs.length > 0 ? (
          <nav className="mt-3 flex flex-wrap items-center gap-1 text-sm">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                {index > 0 ? <span className="text-[var(--acton-muted)]">/</span> : null}
                <button
                  type="button"
                  className="text-[var(--acton-navy)] underline-offset-2 hover:underline"
                  disabled={busy}
                  onClick={() => void browse(crumb.id)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        ) : null}

        {accessWarning ? <p className="mt-3 text-sm text-amber-800">{accessWarning}</p> : null}

        <div className="mt-3 overflow-x-auto rounded-md border border-[var(--acton-border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--acton-gray-50)] text-xs text-[var(--acton-muted)] uppercase">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all supported"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(
                          new Set(items.filter((i) => i.supported || i.isFolder).map((i) => i.id)),
                        );
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                  />
                </th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Modified</th>
                <th className="px-3 py-2">Baxter</th>
                <th className="px-3 py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-[var(--acton-muted)]">
                    Open a connected root with “Open browser”, or click Browse files.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const status = selectionStatus(item, selections);
                  return (
                    <tr key={item.id} className="border-t border-[var(--acton-border)]">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {item.isFolder ? (
                          <button
                            type="button"
                            className="font-medium text-[var(--acton-navy)] underline-offset-2 hover:underline"
                            onClick={() => void browse(item.id)}
                          >
                            📁 {item.name}
                          </button>
                        ) : (
                          <span>{item.name}</span>
                        )}
                        {item.owner ? (
                          <div className="text-xs text-[var(--acton-muted)]">{item.owner}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{mimeLabel(item.mimeType, item.isFolder)}</td>
                      <td className="px-3 py-2 text-xs">
                        {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{status.replace("_", " ")}</td>
                      <td className="px-3 py-2">
                        {item.webViewLink ? (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--acton-navy)] underline"
                          >
                            Drive
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={busy || selectedItems.length === 0 || !activeRoot}
            onClick={() => {
              void (async () => {
                for (const item of selectedItems) {
                  await runAction({
                    action: "add_selection",
                    rootId: activeRoot!.id,
                    googleFileId: item.id,
                    selectionType: item.isFolder ? "folder" : "file",
                    recursive: item.isFolder,
                    includeFutureFiles: item.isFolder,
                    title: item.name,
                    mimeType: item.mimeType,
                    driveId: item.driveId,
                    parentFileId: currentFolderId,
                    defaultCategory: "Google Workspace",
                    defaultTags: ["google"],
                  });
                }
                setSelectedIds(new Set());
                setMessage("Added to Baxter selection. Run sync to import.");
              })();
            }}
          >
            Add to Baxter
          </Button>
          <Button
            disabled={busy || selectedItems.length === 0 || !activeRoot}
            variant="secondary"
            onClick={() => {
              void (async () => {
                for (const item of selectedItems) {
                  await runAction({
                    action: "exclude_selection",
                    rootId: activeRoot!.id,
                    googleFileId: item.id,
                    selectionType: item.isFolder ? "folder" : "file",
                    title: item.name,
                    mimeType: item.mimeType,
                  });
                }
                setSelectedIds(new Set());
              })();
            }}
          >
            Exclude from Baxter
          </Button>
          <Button
            disabled={busy || selectedItems.filter((i) => !i.isFolder).length === 0}
            variant="secondary"
            onClick={() => {
              const file = selectedItems.find((i) => !i.isFolder);
              if (!file) return;
              void runAction({
                action: "preview_file",
                googleFileId: file.id,
                parentFileId: currentFolderId,
              });
            }}
          >
            Preview selected
          </Button>
          <Button
            disabled={busy || selectedItems.length === 0}
            variant="secondary"
            onClick={() => void runSyncNow()}
          >
            Sync selected now
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </Button>
        </div>

        {preview ? (
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs">
            {preview}
          </pre>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Current selections</CardTitle>
        {selections.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">No sources selected yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {selections.map((sel) => (
              <li
                key={sel.id}
                className="flex flex-col gap-2 rounded-md border border-[var(--acton-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium text-[var(--acton-navy)]">
                    {sel.title_snapshot ?? sel.google_file_id}
                  </div>
                  <div className="text-xs text-[var(--acton-muted)]">
                    {sel.selection_type}
                    {sel.explicitly_excluded ? " · excluded" : ""}
                    {sel.selection_type === "folder"
                      ? ` · recursive=${sel.recursive} · future=${sel.include_future_files}`
                      : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void runAction({ action: "remove_selection", selectionId: sel.id })
                  }
                >
                  Remove from Baxter
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--acton-muted)]">
          Removing a source archives the Knowledge Base entry and stops sync. The original Google
          file is never modified or deleted.
        </p>
      </Card>

      <Card>
        <CardTitle>Recent sync runs</CardTitle>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">No sync runs recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Trigger</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-3">Failed</th>
                  <th className="py-2 pr-3">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-[var(--acton-border)]">
                    <td className="py-2 pr-3">{new Date(run.started_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{run.trigger_source}</td>
                    <td className="py-2 pr-3">{run.status}</td>
                    <td className="py-2 pr-3">{run.created_count}</td>
                    <td className="py-2 pr-3">{run.updated_count}</td>
                    <td className="py-2 pr-3">{run.failed_count}</td>
                    <td className="py-2 pr-3">
                      {run.duration_ms != null ? `${Math.round(run.duration_ms / 1000)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {message ? <p className="text-sm text-[var(--acton-navy)]">{message}</p> : null}
    </div>
  );
}
