"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { File, FileImage, FileSpreadsheet, FileText, Folder, Presentation } from "lucide-react";
import type { ConnectorHealth } from "@/lib/connectors/types";
import type { GoogleSyncFolder } from "@/lib/connectors/google/types";
import { googleFileIconKind } from "@/lib/connectors/google/file-icons";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type GoogleConfig = {
  configured: boolean;
  authMode?: string;
  oauthConfigured?: boolean;
  projectIdPresent: boolean;
  clientEmail: string | null;
  privateKeyFormatValid: boolean;
  rootFolderConfigured: boolean;
  rootFolderRaw: string | null;
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  connection?: {
    id: string;
    auth_mode: string;
    google_account_email: string | null;
    hosted_domain: string | null;
    status: string;
    connected_at: string | null;
    last_success_at: string | null;
    last_error_code: string | null;
    last_error_message_safe: string | null;
    granted_scopes: string[];
    hasRefreshToken: boolean;
  } | null;
};

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

type SyncedFile = {
  google_file_id: string;
  knowledge_entry_id: string | null;
  sync_status: string;
  last_error_message_safe: string | null;
  title: string;
};

type SyncedStats = {
  synced: number;
  failed: number;
  excluded: number;
  unsupported: number;
  accessLost: number;
  pending: number;
};

type ManagerHealth = { state: string; label: string; details: string };

type Panel = "browser" | "settings" | "diagnostics";

function mimeLabel(mime: string, isFolder: boolean) {
  if (isFolder) return "Folder";
  if (mime.includes("presentation") && mime.includes("google-apps")) return "Google Slides";
  if (mime.includes("presentationml") || mime.includes("ms-powerpoint")) return "PowerPoint";
  if (mime.includes("document") && mime.includes("google-apps")) return "Google Doc";
  if (mime.includes("document")) return "Google Doc";
  if (mime.includes("spreadsheet") && mime.includes("google-apps")) return "Google Sheet";
  if (mime.includes("spreadsheetml") || mime.includes("ms-excel")) return "Excel (XLSX)";
  if (mime === "text/csv") return "CSV";
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("wordprocessingml")) return "Word (DOCX)";
  if (mime.startsWith("image/")) return "Image";
  if (mime === "text/markdown") return "Markdown";
  if (mime.startsWith("text/")) return "Text";
  return "File";
}

function FileTypeIcon({ mime, isFolder }: { mime: string; isFolder: boolean }) {
  const kind = googleFileIconKind(mime, isFolder);
  const className = "mt-0.5 h-4 w-4 shrink-0 text-[var(--acton-muted)]";
  switch (kind) {
    case "folder":
      return <Folder className={className} aria-hidden />;
    case "sheet":
      return <FileSpreadsheet className={`${className} text-emerald-700`} aria-hidden />;
    case "xlsx":
    case "csv":
      return <FileSpreadsheet className={`${className} text-emerald-700`} aria-hidden />;
    case "doc":
    case "word":
    case "markdown":
      return <FileText className={`${className} text-sky-700`} aria-hidden />;
    case "slides":
    case "pptx":
      return <Presentation className={`${className} text-amber-700`} aria-hidden />;
    case "pdf":
      return <FileText className={`${className} text-red-700`} aria-hidden />;
    case "image":
      return <FileImage className={`${className} text-violet-700`} aria-hidden />;
    default:
      return <File className={className} aria-hidden />;
  }
}

function baxterStatus(
  item: BrowseItem,
  selections: Selection[],
  synced: SyncedFile[],
): { label: string; tone: string } {
  if (item.isFolder) {
    const sel = selections.find((s) => s.google_file_id === item.id && s.enabled);
    if (sel && !sel.explicitly_excluded)
      return { label: "Synced folder", tone: "text-emerald-700" };
    return { label: "Folder", tone: "text-[var(--acton-muted)]" };
  }
  if (!item.supported) {
    return { label: "Not indexed yet", tone: "text-amber-800" };
  }
  const sync = synced.find((s) => s.google_file_id === item.id);
  const sel = selections.find(
    (s) => s.google_file_id === item.id && s.enabled && !s.explicitly_excluded,
  );
  if (sync?.sync_status === "failed") return { label: "Sync failed", tone: "text-red-700" };
  if (sync?.sync_status === "syncing" || sync?.sync_status === "queued") {
    return { label: "Syncing", tone: "text-sky-700" };
  }
  if (sel && sync?.knowledge_entry_id)
    return { label: "Added to Baxter", tone: "text-emerald-700" };
  if (sel && !sync?.knowledge_entry_id) return { label: "Syncing", tone: "text-sky-700" };
  if (sync?.sync_status === "stale") return { label: "Updated in Google", tone: "text-amber-800" };
  return { label: "Not in Baxter", tone: "text-[var(--acton-muted)]" };
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function GoogleConnectorClient({
  initialHealth,
  initialFolders,
  initialConfig,
  initialAuthenticated,
  initialManagerHealth,
  initialAccessMode = "unknown",
  initialWritesEnabled = false,
  oauthNotice,
}: {
  initialHealth: ConnectorHealth;
  initialFolders: GoogleSyncFolder[];
  initialConfig: GoogleConfig;
  initialAuthenticated: boolean;
  initialManagerHealth: ManagerHealth;
  initialAccessMode?: "read_only" | "read_write" | "unknown";
  initialWritesEnabled?: boolean;
  oauthNotice?: {
    success?: boolean;
    connectedAs?: string | null;
    error?: string | null;
    message?: string | null;
    offerReconnect?: boolean;
  };
}) {
  const [health] = useState(initialHealth);
  const [folders, setFolders] = useState(initialFolders);
  const [config, setConfig] = useState(initialConfig);
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [managerHealth] = useState(initialManagerHealth);
  const [accessMode] = useState(initialAccessMode);
  const [writesEnabled] = useState(initialWritesEnabled);
  const [panel, setPanel] = useState<Panel>("browser");
  const [sharedDrives, setSharedDrives] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() => {
    if (oauthNotice?.success) {
      return oauthNotice.connectedAs
        ? `Connected as ${oauthNotice.connectedAs}`
        : "Google Workspace connected";
    }
    return null;
  });
  const [error, setError] = useState<string | null>(() =>
    oauthNotice?.error ? oauthNotice.message || oauthNotice.error : null,
  );
  const [offerReconnect] = useState(Boolean(oauthNotice?.offerReconnect));
  const [technical, setTechnical] = useState<string | null>(null);

  const primaryRoot = useMemo(
    () =>
      folders.find((f) => f.is_primary && f.status === "active") ??
      folders.find((f) => f.status === "active") ??
      folders[0] ??
      null,
    [folders],
  );

  const [activeRootId, setActiveRootId] = useState<string | null>(primaryRoot?.id ?? null);
  const activeRoot = folders.find((f) => f.id === activeRootId) ?? primaryRoot;

  const [items, setItems] = useState<BrowseItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [syncedFiles, setSyncedFiles] = useState<SyncedFile[]>([]);
  const [syncedStats, setSyncedStats] = useState<SyncedStats | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState<"all" | "supported" | "docs" | "sheets" | "folders">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<"all" | "in_baxter" | "not_in_baxter">("all");
  const [browserLoading, setBrowserLoading] = useState(false);
  const [progress, setProgress] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    mimeType: string;
    webViewLink: string | null;
    modifiedTime: string | null;
    previewText: string;
    parseMode: string;
  } | null>(null);
  const [showAdvancedRoot, setShowAdvancedRoot] = useState(false);
  const [manualFolderId, setManualFolderId] = useState("");
  const [diagResult, setDiagResult] = useState<unknown>(null);

  const connectedEmail =
    config.connection?.google_account_email ||
    oauthNotice?.connectedAs ||
    (authenticated ? "Connected Google account" : null);

  const isConnected =
    authenticated ||
    config.connection?.status === "connected" ||
    (config.authMode === "service_account" && config.configured);

  async function api(action: string, body: Record<string, unknown> = {}) {
    const response = await fetch("/api/admin/connectors/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string };
      result?: unknown;
      folder?: GoogleSyncFolder;
      selection?: Selection;
      files?: SyncedFile[];
      sync?: unknown;
      knowledgeEntryIds?: string[];
      selectionCount?: number;
      removed?: number;
      reconcile?: unknown;
      ok?: boolean;
    };
    if (!response.ok) {
      const err = new Error(payload.error?.message ?? "Action failed") as Error & {
        code?: string;
      };
      err.code = payload.error?.code;
      throw err;
    }
    return payload;
  }

  async function refreshOverview() {
    const response = await fetch("/api/admin/connectors/google");
    const payload = (await response.json()) as {
      folders?: GoogleSyncFolder[];
      config?: GoogleConfig;
      authenticated?: boolean;
      selections?: Selection[];
      syncedStats?: SyncedStats;
    };
    if (payload.folders) setFolders(payload.folders);
    if (payload.config) setConfig(payload.config);
    if (typeof payload.authenticated === "boolean") setAuthenticated(payload.authenticated);
    if (payload.selections) setSelections(payload.selections);
    if (payload.syncedStats) setSyncedStats(payload.syncedStats);
  }

  const loadBrowser = useCallback(
    async (root: GoogleSyncFolder, folderId?: string | null) => {
      setBrowserLoading(true);
      setError(null);
      try {
        const target = folderId || root.last_browsed_folder_id || root.folder_id;
        const payload = await api("browse", {
          rootId: root.id,
          currentFolderId: target,
          search: search || undefined,
          fileType,
        });
        const result = payload.result as {
          items?: BrowseItem[];
          breadcrumbs?: Array<{ id: string; name: string }>;
          currentFolderId?: string;
          selections?: Selection[];
          message?: string;
          pass?: boolean;
        };
        if (result.pass === false) {
          throw Object.assign(new Error(result.message || "Could not load folder"), {
            code: "GOOGLE_BROWSER_LOAD_FAILED",
          });
        }
        setItems(result.items ?? []);
        setBreadcrumbs(result.breadcrumbs ?? [{ id: root.folder_id, name: root.folder_name }]);
        setCurrentFolderId(result.currentFolderId ?? target);
        if (result.selections) setSelections(result.selections);
        const synced = await api("list_synced_files", { rootId: root.id });
        setSyncedFiles(synced.files ?? []);
        setActiveRootId(root.id);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Baxter could not load this folder. Try refreshing.",
        );
        setTechnical(err instanceof Error ? String(err) : null);
      } finally {
        setBrowserLoading(false);
      }
    },
    [fileType, search],
  );

  // Returning-user: auto-open browser when connected + root exists
  useEffect(() => {
    if (!isConnected || !activeRoot || panel !== "browser") return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadBrowser(activeRoot);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / root change only
  }, [isConnected, activeRoot?.id, panel]);

  useEffect(() => {
    if (!isConnected || activeRoot) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoadingDrives(true);
      try {
        const payload = await api("list_shared_drives");
        if (cancelled) return;
        const result = payload.result as {
          drives?: Array<{ id: string; name: string }>;
          pass?: boolean;
        };
        setSharedDrives(result.drives ?? []);
      } catch {
        if (!cancelled) setSharedDrives([]);
      } finally {
        if (!cancelled) setLoadingDrives(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected, activeRoot]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter === "all") return true;
      const status = baxterStatus(item, selections, syncedFiles).label;
      if (statusFilter === "in_baxter")
        return status === "Added to Baxter" || status === "Synced folder";
      return status === "Not in Baxter";
    });
  }, [items, selections, syncedFiles, statusFilter]);

  const selectedItems = visibleItems.filter((i) => selectedIds.has(i.id));
  const selectedInBaxter = selectedItems.filter((i) => {
    const s = baxterStatus(i, selections, syncedFiles).label;
    return s === "Added to Baxter" || s === "Synced folder" || s === "Syncing";
  });
  const selectedNotInBaxter = selectedItems.filter((i) => {
    const s = baxterStatus(i, selections, syncedFiles).label;
    return s === "Not in Baxter";
  });

  async function connectDriveAsRoot(drive: { id: string; name: string }) {
    setBusy("connect-drive");
    setError(null);
    setMessage(null);
    try {
      const payload = await api("add_folder", { folderId: drive.id, driveId: drive.id });
      const folder = payload.folder!;
      setFolders((prev) => {
        const without = prev.filter((f) => f.folder_id !== folder.folder_id);
        return [...without, folder];
      });
      setActiveRootId(folder.id);
      setMessage(`Drive connection saved — ${folder.folder_name}`);
      setPanel("browser");
      await loadBrowser(folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect this Drive.");
    } finally {
      setBusy(null);
    }
  }

  async function addSelectedToBaxter() {
    if (!activeRoot || selectedNotInBaxter.length === 0) return;
    const unsupported = selectedNotInBaxter.filter((i) => !i.supported && !i.isFolder);
    if (unsupported.length) {
      setError(
        `${unsupported.length} unsupported file(s) cannot be imported. Deselect them or choose Supported files.`,
      );
      return;
    }

    const foldersSelected = selectedNotInBaxter.filter((i) => i.isFolder);
    let recursive = true;
    let includeFuture = true;
    if (foldersSelected.length > 0) {
      const ok = window.confirm(
        `Add ${foldersSelected[0] ? `“${foldersSelected[0].name}”` : "these folders"} to Baxter?\n\nBaxter will keep supported files in this folder synchronized (including subfolders and files added later).\n\nCancel to abort.`,
      );
      if (!ok) return;
      recursive = true;
      includeFuture = true;
    }

    setBusy("add");
    setProgress(["Reading files", "Extracting content", "Updating Knowledge Base"]);
    setError(null);
    setMessage(null);
    try {
      const payload = await api("add_to_baxter", {
        rootId: activeRoot.id,
        files: selectedNotInBaxter.map((item) => ({
          googleFileId: item.id,
          selectionType: item.isFolder ? "folder" : "file",
          title: item.name,
          mimeType: item.mimeType,
          driveId: item.driveId,
          parentFileId: currentFolderId,
          recursive,
          includeFutureFiles: includeFuture,
        })),
      });
      setProgress(["Complete"]);
      setMessage(`${payload.selectionCount ?? selectedNotInBaxter.length} file(s) added to Baxter`);
      setSelectedIds(new Set());
      await loadBrowser(activeRoot, currentFolderId);
      await refreshOverview();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "This file was selected, but its Knowledge entry could not be created. Retry the import.",
      );
    } finally {
      setBusy(null);
      setTimeout(() => setProgress(null), 1500);
    }
  }

  async function removeSelectedFromBaxter() {
    if (!activeRoot || selectedInBaxter.length === 0) return;
    const names = selectedInBaxter
      .map((i) => i.name)
      .slice(0, 3)
      .join(", ");
    const more = selectedInBaxter.length > 3 ? ` and ${selectedInBaxter.length - 3} more` : "";
    if (
      !window.confirm(
        `Remove “${names}${more}” from Baxter?\n\nBaxter will stop using ${selectedInBaxter.length === 1 ? "this file" : "these files"}. The original Google Drive file will not be changed.`,
      )
    ) {
      return;
    }
    setBusy("remove");
    setError(null);
    try {
      await api("remove_from_baxter", {
        rootId: activeRoot.id,
        googleFileIds: selectedInBaxter.map((i) => i.id),
      });
      setMessage(
        selectedInBaxter.length === 1
          ? "File removed from Baxter"
          : `${selectedInBaxter.length} files removed from Baxter`,
      );
      setSelectedIds(new Set());
      await loadBrowser(activeRoot, currentFolderId);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from Baxter.");
    } finally {
      setBusy(null);
    }
  }

  async function syncChanges() {
    if (!activeRoot) return;
    setBusy("sync");
    setProgress(["Checking selected files", "Importing updates", "Updating Knowledge Base"]);
    setError(null);
    try {
      await api("sync", { rootId: activeRoot.id, id: activeRoot.id });
      setMessage("Knowledge updated");
      await loadBrowser(activeRoot, currentFolderId);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed. Try again.");
    } finally {
      setBusy(null);
      setTimeout(() => setProgress(null), 1200);
    }
  }

  async function openPreview(item: BrowseItem) {
    if (item.isFolder) {
      if (activeRoot) void loadBrowser(activeRoot, item.id);
      return;
    }
    setBusy(`preview-${item.id}`);
    try {
      const payload = await api("preview_file", {
        googleFileId: item.id,
        parentFileId: currentFolderId,
      });
      const result = payload.result as typeof preview;
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  // ---------- STATE A: NOT CONNECTED ----------
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Connectors
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[var(--acton-navy)]">Google Workspace</h1>
          <p className="mt-2 text-[var(--acton-muted)]">
            Connect Baxter to Acton ADU Google Drive so administrators can choose which documents
            Baxter may use.
          </p>
        </header>
        {error ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <p>{error}</p>
            {offerReconnect ? (
              <a
                href="/api/admin/connectors/google/oauth/start?consent=1"
                className="mt-3 inline-flex font-semibold underline"
              >
                Reconnect with baxter@actonadu.com
              </a>
            ) : null}
          </div>
        ) : null}
        <Card className="p-8">
          <CardTitle>Connect Google Workspace</CardTitle>
          <CardDescription className="mt-2">
            Sign in with an Acton ADU Google account that can see the Shared Drive.
          </CardDescription>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/api/admin/connectors/google/oauth/start?consent=1"
              className="inline-flex h-11 items-center rounded-md bg-[var(--acton-navy)] px-5 text-sm font-semibold text-white"
            >
              Connect Google Workspace
            </a>
            <button
              type="button"
              className="text-sm font-semibold text-[var(--acton-navy)] underline"
              onClick={() => setPanel("diagnostics")}
            >
              Advanced setup
            </button>
          </div>
        </Card>
        {panel === "diagnostics" ? (
          <Card className="p-6 text-sm text-[var(--acton-muted)]">
            <p>
              Prefer Workspace OAuth for Shared Drives. Service-account credentials remain available
              as a fallback when the account can access the Drive.
            </p>
            <p className="mt-2">
              Health: {health.status} · Configured: {config.configured ? "yes" : "no"}
            </p>
          </Card>
        ) : null}
      </div>
    );
  }

  // ---------- STATE B: CONNECTED, NO ROOT ----------
  if (!activeRoot) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-[var(--acton-navy)]">Google Workspace</h1>
          <p className="mt-2 text-[var(--acton-muted)]">
            Connected as{" "}
            <span className="font-semibold text-[var(--acton-navy)]">{connectedEmail}</span>
          </p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Choose where Baxter should browse.
          </p>
        </header>
        {message ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}
        {loadingDrives ? (
          <p className="text-sm text-[var(--acton-muted)]" aria-live="polite">
            Loading Drive…
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sharedDrives.map((drive) => (
              <button
                key={drive.id}
                type="button"
                disabled={busy === "connect-drive"}
                onClick={() => void connectDriveAsRoot(drive)}
                className="rounded-2xl border border-[var(--acton-border)] bg-white p-6 text-left shadow-sm transition hover:border-[var(--acton-navy)]"
              >
                <p className="text-xl font-bold text-[var(--acton-navy)]">{drive.name}</p>
                <p className="mt-1 text-sm text-[var(--acton-muted)]">Shared Drive</p>
                <p className="mt-4 text-sm font-semibold text-[var(--acton-navy)]">
                  Use this Drive
                </p>
              </button>
            ))}
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={async () => {
                setBusy("my-drive");
                try {
                  const payload = await api("browse_my_drive");
                  const result = payload.result as { items?: BrowseItem[]; pass?: boolean };
                  if (!result.pass) throw new Error("Could not open My Drive");
                  // Connect root as "root" for My Drive browsing via add_folder with special handling
                  setMessage("Use Advanced options to connect a My Drive folder by URL or ID.");
                  setShowAdvancedRoot(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "My Drive unavailable");
                } finally {
                  setBusy(null);
                }
              }}
              className="rounded-2xl border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-6 text-left"
            >
              <p className="text-lg font-bold text-[var(--acton-navy)]">Browse My Drive</p>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                Connect a personal folder under Advanced options.
              </p>
            </button>
          </div>
        )}
        <div>
          <button
            type="button"
            className="text-sm font-semibold underline"
            onClick={() => setShowAdvancedRoot((v) => !v)}
          >
            Advanced options
          </button>
          {showAdvancedRoot ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="min-w-[240px] flex-1 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                placeholder="Folder URL or ID"
                value={manualFolderId}
                onChange={(e) => setManualFolderId(e.target.value)}
                aria-label="Manual folder URL or ID"
              />
              <Button
                type="button"
                disabled={!manualFolderId.trim() || busy === "connect-drive"}
                onClick={() =>
                  void connectDriveAsRoot({ id: manualFolderId.trim(), name: "Google Drive" })
                }
              >
                Connect folder
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            href="/api/admin/connectors/google/oauth/start?consent=1"
            className="font-semibold underline"
          >
            Reconnect account
          </a>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setPanel("diagnostics")}
          >
            Advanced diagnostics
          </button>
        </div>
      </div>
    );
  }

  // ---------- STATE C: CONNECTED WITH ROOT (primary) ----------
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[var(--acton-navy)]">Google Workspace</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Connected as{" "}
            <span className="font-semibold text-[var(--acton-navy)]">{connectedEmail}</span>
          </p>
          <p className="mt-0.5 font-semibold text-[var(--acton-navy)]">
            {activeRoot.folder_name}
            {activeRoot.drive_id ? " Shared Drive" : ""}
          </p>
          <p className="text-sm text-[var(--acton-muted)]">
            Last synchronized: {formatWhen(activeRoot.last_sync_at || activeRoot.last_success_at)}
          </p>
          {syncedStats ? (
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {syncedStats.synced} current · {syncedStats.pending} pending
              {syncedStats.failed > 0 ? ` · ${syncedStats.failed} need attention` : ""}
            </p>
          ) : null}
          {writesEnabled || accessMode === "read_write" ? (
            <p className="mt-2 text-sm font-semibold text-emerald-800">
              Access: read-write (project setup can create Drive folders and Sheets rows)
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-900">
              Access: read-only.{" "}
              <a
                href="/api/admin/connectors/google/oauth/start?consent=1"
                className="font-semibold underline"
              >
                Reconnect to enable writes
              </a>{" "}
              for new-project setup (Drive + Sheets).
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy === "sync"} onClick={() => void syncChanges()}>
            {busy === "sync" ? "Syncing changes…" : "Sync changes"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPanel(panel === "settings" ? "browser" : "settings")}
          >
            Connection settings
          </Button>
        </div>
      </header>

      {message ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          {message}
          {message.includes("added to Baxter") ? (
            <>
              {" "}
              <Link href="/admin/knowledge" className="font-semibold underline">
                View in Knowledge Center
              </Link>
            </>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <p>{error}</p>
          {offerReconnect ? (
            <a
              href="/api/admin/connectors/google/oauth/start?consent=1"
              className="mt-3 inline-flex font-semibold underline"
            >
              Reconnect with baxter@actonadu.com
            </a>
          ) : null}
          {technical ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold">Show technical details</summary>
              <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap">{technical}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {progress ? (
        <div
          className="rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm"
          aria-live="polite"
        >
          <p className="font-semibold text-sky-900">
            {busy === "add"
              ? `Adding ${selectedNotInBaxter.length || ""} files to Baxter`
              : "Syncing changes…"}
          </p>
          <ul className="mt-1 list-inside list-disc text-sky-800">
            {progress.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel === "settings" ? (
        <Card className="space-y-4 p-6">
          <CardTitle>Connection settings</CardTitle>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--acton-muted)]">Connected account</dt>
              <dd className="font-semibold">{connectedEmail}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Access</dt>
              <dd className="font-semibold">
                {writesEnabled || accessMode === "read_write" ? "Read-write" : "Read-only"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Active Drive</dt>
              <dd className="font-semibold">{activeRoot.folder_name}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Automatic sync</dt>
              <dd className="font-semibold">{config.syncEnabled ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Last sync</dt>
              <dd className="font-semibold">{formatWhen(activeRoot.last_sync_at)}</dd>
            </div>
            <div>
              <dt className="text-[var(--acton-muted)]">Manager health</dt>
              <dd className="font-semibold">{managerHealth.label}</dd>
            </div>
          </dl>
          {folders.length > 1 ? (
            <div>
              <label className="text-sm font-semibold" htmlFor="root-select">
                Switch Drive
              </label>
              <select
                id="root-select"
                className="mt-1 block w-full max-w-md rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                value={activeRoot.id}
                onChange={(e) => {
                  const next = folders.find((f) => f.id === e.target.value);
                  if (next) {
                    setActiveRootId(next.id);
                    void api("set_primary_root", { rootId: next.id }).catch(() => undefined);
                    void loadBrowser(next);
                  }
                }}
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.folder_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/admin/connectors/google/oauth/start?consent=1"
              className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-semibold"
            >
              Reconnect account
            </a>
            <Button type="button" variant="secondary" onClick={() => setActiveRootId(null)}>
              Change Drive
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Disconnect this Drive from Baxter? Google files are not deleted.",
                  )
                )
                  return;
                await api("remove_folder", { id: activeRoot.id });
                setFolders((prev) => prev.filter((f) => f.id !== activeRoot.id));
                setActiveRootId(null);
                setMessage("Drive disconnected from Baxter");
              }}
            >
              Disconnect
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPanel("diagnostics")}>
              Advanced diagnostics
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPanel("browser")}>
              Back to files
            </Button>
          </div>
        </Card>
      ) : null}

      {panel === "diagnostics" ? (
        <Card className="space-y-3 p-6">
          <CardTitle>Advanced diagnostics</CardTitle>
          <CardDescription>
            For administrators troubleshooting connector issues. Not required for daily use.
          </CardDescription>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["test_auth", "Credential test"],
                ["test_root_folder", "Root folder test"],
                ["list_sample_files", "Sample listing"],
                ["dry_run_sync", "Dry-run sync"],
                ["process_one_job", "Process pending job"],
                ["test_google_through_baxter", "Test through Baxter"],
                ["reconcile", "Repair Google knowledge"],
              ] as const
            ).map(([action, label]) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={async () => {
                  setBusy(action);
                  try {
                    const payload = await api(action, { rootId: activeRoot.id, repair: true });
                    setDiagResult(payload.result ?? payload.reconcile ?? payload);
                    setMessage(`${label} finished`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Diagnostic failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {label}
              </Button>
            ))}
            <Button type="button" size="sm" variant="secondary" onClick={() => setPanel("browser")}>
              Back to files
            </Button>
          </div>
          {diagResult ? (
            <details open>
              <summary className="cursor-pointer text-sm font-semibold">Technical output</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-[var(--acton-gray-50)] p-3 text-xs">
                {JSON.stringify(diagResult, null, 2)}
              </pre>
            </details>
          ) : null}
        </Card>
      ) : null}

      {panel === "browser" || panel === "settings" ? (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--acton-border)] px-4 py-3">
            <input
              className="min-w-[160px] flex-1 rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
              placeholder="Search by name or paste a Google URL…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && activeRoot) void loadBrowser(activeRoot, currentFolderId);
              }}
              aria-label="Search files or paste Google URL"
            />
            <select
              className="rounded-md border border-[var(--acton-border)] px-2 py-2 text-sm"
              value={fileType}
              onChange={(e) => setFileType(e.target.value as typeof fileType)}
              aria-label="File type filter"
            >
              <option value="all">All types</option>
              <option value="supported">Supported</option>
              <option value="docs">Docs</option>
              <option value="sheets">Sheets</option>
              <option value="folders">Folders</option>
            </select>
            <select
              className="rounded-md border border-[var(--acton-border)] px-2 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Baxter status filter"
            >
              <option value="all">Any status</option>
              <option value="in_baxter">In Baxter</option>
              <option value="not_in_baxter">Not in Baxter</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={browserLoading}
              onClick={() => activeRoot && void loadBrowser(activeRoot, currentFolderId)}
            >
              {browserLoading ? "Opening folder…" : "Refresh"}
            </Button>
          </div>

          <nav
            className="flex gap-1 overflow-x-auto border-b border-[var(--acton-border)] px-4 py-2 text-sm"
            aria-label="Folder breadcrumbs"
          >
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1 whitespace-nowrap">
                {index > 0 ? <span className="text-[var(--acton-muted)]">/</span> : null}
                <button
                  type="button"
                  className="font-semibold text-[var(--acton-navy)] hover:underline"
                  onClick={() => activeRoot && void loadBrowser(activeRoot, crumb.id)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--acton-border)] px-4 py-2">
            <Button
              type="button"
              size="sm"
              disabled={selectedNotInBaxter.length === 0 || busy === "add"}
              onClick={() => void addSelectedToBaxter()}
            >
              {busy === "add" ? "Adding files to Baxter…" : "Add selected to Baxter"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={selectedInBaxter.length === 0 || busy === "remove"}
              onClick={() => void removeSelectedFromBaxter()}
            >
              {busy === "remove" ? "Removing file…" : "Remove selected from Baxter"}
            </Button>
            <button
              type="button"
              className="text-xs font-semibold underline"
              onClick={() => {
                const supported = visibleItems.filter((i) => i.supported || i.isFolder);
                setSelectedIds(new Set(supported.map((i) => i.id)));
              }}
            >
              Select all supported in folder
            </button>
            <span className="text-xs text-[var(--acton-muted)]">{selectedIds.size} selected</span>
          </div>

          {browserLoading && items.length === 0 ? (
            <p
              className="px-4 py-10 text-center text-sm text-[var(--acton-muted)]"
              aria-live="polite"
            >
              Loading Drive…
            </p>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="font-semibold text-[var(--acton-navy)]">
                This folder does not contain any files Baxter can import.
              </p>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                No files from this Drive have been added to Baxter yet — or none match your filters.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--acton-gray-50)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                    <tr>
                      <th className="px-3 py-2">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Modified</th>
                      <th className="px-3 py-2">Baxter status</th>
                      <th className="px-3 py-2">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const status = baxterStatus(item, selections, syncedFiles);
                      return (
                        <tr key={item.id} className="border-t border-[var(--acton-border)]">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              disabled={!item.supported && !item.isFolder}
                              aria-label={`Select ${item.name}`}
                              onChange={() => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              className="flex items-start gap-2 text-left font-semibold text-[var(--acton-navy)] hover:underline"
                              onClick={() => void openPreview(item)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void openPreview(item);
                              }}
                            >
                              <FileTypeIcon mime={item.mimeType} isFolder={item.isFolder} />
                              <span>{item.name}</span>
                            </button>
                            {!item.supported && !item.isFolder ? (
                              <p className="pl-6 text-xs text-amber-800">
                                {mimeLabel(item.mimeType, false)} — not indexed automatically yet
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-[var(--acton-muted)]">
                            {mimeLabel(item.mimeType, item.isFolder)}
                          </td>
                          <td className="px-3 py-3 text-[var(--acton-muted)]">
                            {formatWhen(item.modifiedTime)}
                          </td>
                          <td className={`px-3 py-3 font-medium ${status.tone}`}>{status.label}</td>
                          <td className="px-3 py-3">
                            {item.webViewLink ? (
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold underline"
                              >
                                Open in Google
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-2 p-3 md:hidden">
                {visibleItems.map((item) => {
                  const status = baxterStatus(item, selections, syncedFiles);
                  return (
                    <li
                      key={item.id}
                      className="rounded-xl border border-[var(--acton-border)] bg-white p-3"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedIds.has(item.id)}
                          disabled={!item.supported && !item.isFolder}
                          aria-label={`Select ${item.name}`}
                          onChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="text-left font-semibold text-[var(--acton-navy)]"
                            onClick={() => void openPreview(item)}
                          >
                            {item.name}
                          </button>
                          <p className="text-xs text-[var(--acton-muted)]">
                            {mimeLabel(item.mimeType, item.isFolder)} · {status.label}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          role="dialog"
          aria-modal="true"
          aria-label="File preview"
        >
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold text-[var(--acton-navy)]">{preview.title}</h2>
              <button
                type="button"
                className="text-sm font-semibold"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-[var(--acton-muted)]">
              {mimeLabel(preview.mimeType, false)} · {formatWhen(preview.modifiedTime)}
            </p>
            {preview.webViewLink ? (
              <a
                href={preview.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-semibold underline"
              >
                Open in Google
              </a>
            ) : null}
            <pre className="mt-4 max-h-80 overflow-auto rounded bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap">
              {preview.previewText || "No extracted preview available."}
            </pre>
            <Button type="button" className="mt-4" onClick={() => setPreview(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
