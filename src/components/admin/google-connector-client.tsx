"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { ConnectorHealth } from "@/lib/connectors/types";
import type { GoogleSyncFolder } from "@/lib/connectors/google/types";
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
  privateKeyValidFormat?: boolean;
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  identityNote?: string;
  serviceAccountExternalWarning?: string;
  domainWideDelegationAvailable?: boolean;
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

type SharedDrive = { id: string; name: string };

type FriendlyResult = {
  title: string;
  lines: Array<{ label: string; value: string }>;
  guidance?: string[];
  technical?: unknown;
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

function formatActionResult(action: string, result: Record<string, unknown>): FriendlyResult {
  if (action === "test_auth") {
    return {
      title: result.pass ? "Connection successful" : "Connection failed",
      lines: [
        { label: "Authenticated as", value: String(result.email ?? result.clientEmail ?? "—") },
        { label: "Authentication", value: String(result.authMode ?? "—") },
        { label: "Access", value: String(result.access ?? "Read-only") },
        { label: "Google Drive", value: String(result.driveAccess ?? "—") },
        { label: "Google Docs", value: String(result.docsAccess ?? "—") },
        { label: "Google Sheets", value: String(result.sheetsAccess ?? "—") },
      ],
      guidance: Array.isArray(result.guidance) ? (result.guidance as string[]) : undefined,
      technical: result,
    };
  }
  if (action === "test_root_folder") {
    return {
      title: result.pass ? "Root folder accessible" : "Root folder test failed",
      lines: [
        { label: "Folder", value: String(result.folderName ?? result.folderId ?? "—") },
        { label: "Shared Drive", value: result.sharedDrive ? "Yes" : "No" },
        { label: "Sample items", value: String(result.sampleItemCount ?? "—") },
        ...(result.code ? [{ label: "Error code", value: String(result.code) }] : []),
      ],
      guidance: Array.isArray(result.guidance)
        ? (result.guidance as string[])
        : typeof result.guidance === "string"
          ? [result.guidance]
          : undefined,
      technical: result,
    };
  }
  if (action === "list_shared_drives") {
    const drives = (result.drives as SharedDrive[] | undefined) ?? [];
    return {
      title: result.pass ? "Shared Drives" : "Could not list Shared Drives",
      lines: [
        { label: "Count", value: String(drives.length) },
        { label: "Message", value: String(result.message ?? "") },
        ...(result.code ? [{ label: "Error code", value: String(result.code) }] : []),
      ],
      technical: result,
    };
  }
  if (action === "list_sample_files") {
    const files = (result.files as unknown[] | undefined) ?? [];
    return {
      title: result.pass ? "Sample files" : "Could not list sample files",
      lines: [
        { label: "Files found", value: String(files.length) },
        { label: "Message", value: String(result.message ?? "OK") },
      ],
      technical: result,
    };
  }
  if (action === "dry_run_sync") {
    return {
      title: result.pass ? "Dry-run complete" : "Dry-run failed",
      lines: [
        { label: "Discovered", value: String(result.discovered ?? 0) },
        { label: "Would create", value: String(result.wouldCreate ?? 0) },
        { label: "Would update", value: String(result.wouldUpdate ?? 0) },
        { label: "Unchanged", value: String(result.unchanged ?? 0) },
      ],
      technical: result,
    };
  }
  return {
    title: result.pass === false ? "Action failed" : "Done",
    lines: Object.entries(result)
      .filter(([key]) => !["technical", "items", "files", "drives", "guidance"].includes(key))
      .slice(0, 8)
      .map(([label, value]) => ({
        label,
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    technical: result,
  };
}

export function GoogleConnectorClient({
  initialHealth,
  initialFolders,
  initialConfig,
  initialAuthenticated,
  initialManagerHealth,
  oauthNotice,
}: {
  initialHealth: ConnectorHealth;
  initialFolders: GoogleSyncFolder[];
  initialConfig: GoogleConfig;
  initialAuthenticated: boolean;
  initialManagerHealth?: ManagerHealth;
  oauthNotice?: {
    success?: boolean;
    connectedAs?: string | null;
    error?: string | null;
    message?: string | null;
  };
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [friendlyResult, setFriendlyResult] = useState<FriendlyResult | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showOauthSetup, setShowOauthSetup] = useState(false);
  const [sharedDrives, setSharedDrives] = useState<SharedDrive[]>([]);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [archiveOnDisconnect, setArchiveOnDisconnect] = useState(false);

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

  const oauthSuccess = Boolean(oauthNotice?.success);
  const oauthConnectedAs = oauthNotice?.connectedAs ?? null;
  const oauthError = oauthNotice?.error ?? null;
  const oauthMessage = oauthNotice?.message ?? null;

  const connection = config.connection;
  const isOauthConnected =
    connection?.status === "connected" || connection?.status === "reauthorization_required";

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
    } else {
      setMessage(payload.error?.message ?? "Refresh failed");
    }
  }, [managerHealth]);

  async function runAction(body: Record<string, unknown>) {
    const action = String(body.action ?? "action");
    setBusy(true);
    setBusyAction(action);
    setMessage(null);
    setFriendlyResult(null);
    setShowTechnical(false);
    try {
      const response = await fetch("/api/admin/connectors/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Request failed");
        setFriendlyResult({
          title: "Action failed",
          lines: [
            { label: "Code", value: String(payload.error?.code ?? "ERROR") },
            { label: "Message", value: String(payload.error?.message ?? "Request failed") },
          ],
          technical: payload,
        });
        return payload;
      }
      if (payload.result && payload.result.created !== undefined) {
        setMessage(
          `Sync finished: ${payload.result.created} created, ${payload.result.updated} updated, ${payload.result.unchanged} unchanged.`,
        );
      } else if (payload.result) {
        if (payload.result.items) {
          setItems(payload.result.items);
          setBreadcrumbs(payload.result.breadcrumbs ?? []);
          setCurrentFolderId(payload.result.currentFolderId);
          setAccessWarning(payload.result.accessWarning ?? null);
          if (payload.result.rootId) setBrowseRootId(payload.result.rootId);
          if (payload.result.selections) setSelections(payload.result.selections);
          setMessage(
            payload.result.pass === false
              ? (payload.result.message ?? "Browse failed")
              : `Loaded ${payload.result.items.length} item(s).`,
          );
          if (payload.result.pass === false) {
            setFriendlyResult(formatActionResult(action, payload.result));
          }
        } else if (payload.result.drives) {
          setSharedDrives(payload.result.drives as SharedDrive[]);
          setFriendlyResult(formatActionResult(action, payload.result));
          setMessage(String(payload.result.message ?? "Shared Drives loaded."));
        } else if (payload.result.previewText !== undefined) {
          setPreview(JSON.stringify(payload.result, null, 2));
          setMessage("Preview ready.");
        } else {
          setFriendlyResult(formatActionResult(action, payload.result));
          setMessage(payload.result.pass === false ? "Action reported a problem." : "Done.");
        }
      } else if (payload.jobId) {
        setMessage(`Job ${payload.jobId}: ${payload.status ?? "queued"}`);
      } else if (payload.folder) {
        setMessage(`Root connected: ${payload.folder.folder_name}`);
      } else {
        setMessage("Saved.");
      }
      await refresh();
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
      setFriendlyResult({
        title: "Request failed",
        lines: [
          { label: "Error", value: error instanceof Error ? error.message : "Network error" },
        ],
      });
      return null;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function disconnectGoogle() {
    setBusy(true);
    setBusyAction("disconnect");
    try {
      const response = await fetch("/api/admin/connectors/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, archiveKnowledge: archiveOnDisconnect }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Disconnect failed");
      } else {
        setMessage(payload.message ?? "Disconnected");
        setDisconnectConfirm(false);
      }
      await refresh();
    } catch {
      setMessage("Disconnect failed");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function runSyncNow() {
    setBusy(true);
    setBusyAction("sync");
    setMessage(null);
    setSyncPhase("Scanning selected sources…");
    try {
      await new Promise((r) => setTimeout(r, 400));
      setSyncPhase("Reading Google files…");
      const response = await fetch("/api/admin/connectors/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootId: activeRoot?.id ?? null,
          processImmediately: true,
        }),
      });
      setSyncPhase("Parsing and updating Knowledge…");
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Sync failed");
        setSyncPhase(null);
      } else {
        setSyncPhase("Finished.");
        setMessage(
          payload.message ??
            `Sync ${payload.status}${payload.jobId ? ` (job ${payload.jobId})` : ""}`,
        );
      }
      await refresh();
    } catch {
      setMessage("Sync request failed");
      setSyncPhase(null);
    } finally {
      setBusy(false);
      setBusyAction(null);
      setTimeout(() => setSyncPhase(null), 2500);
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
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Google Workspace</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Connect Baxter to an Acton ADU Google account to browse approved Drive files and keep
          selected knowledge synchronized. Access is read-only.
        </p>
        <p className="mt-2 text-sm">
          <Link
            href="/admin/knowledge"
            className="font-semibold text-[var(--acton-navy)] underline"
          >
            ← Back to Knowledge Center
          </Link>
        </p>
      </div>

      {syncPhase ? (
        <Card className="border-sky-200 bg-sky-50/70">
          <CardTitle className="text-base">{syncPhase}</CardTitle>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Sync progress — stay on this page until finished.
          </p>
        </Card>
      ) : null}

      {oauthSuccess ? (
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardTitle className="text-base text-emerald-900">Connected</CardTitle>
          <p className="mt-2 text-sm">
            Connected as: <strong>{oauthConnectedAs ?? connection?.google_account_email}</strong>
          </p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Access: Google Drive, Google Docs, Google Sheets — read only
          </p>
        </Card>
      ) : null}
      {oauthError ? (
        <Card className="border-red-200 bg-red-50/70">
          <CardTitle className="text-base text-red-800">Could not connect Google</CardTitle>
          <p className="mt-2 text-sm">{oauthMessage ?? oauthError}</p>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">Code: {oauthError}</p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Google Workspace connection</CardTitle>
        {!isOauthConnected && config.authMode !== "service_account" ? (
          <>
            <CardDescription className="mt-2">
              Sign in as <strong>baxter@actonadu.com</strong> (or another allowlisted Acton
              Workspace user). The Google Cloud service account is external to Acton ADU and cannot
              join Shared Drives restricted to internal members.
            </CardDescription>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/api/admin/connectors/google/oauth/start">
                <Button disabled={busy || !config.oauthConfigured} type="button">
                  Connect Google Workspace
                </Button>
              </a>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setShowOauthSetup((v) => !v)}
              >
                {showOauthSetup ? "Hide setup guide" : "Setup guide"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                Advanced setup
              </Button>
            </div>
            {!config.oauthConfigured ? (
              <p className="mt-3 text-sm text-amber-800">
                OAuth is not fully configured in Vercel yet. Open the setup guide, add the OAuth
                variables and encryption key, redeploy, then connect.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                Connected account:{" "}
                <strong>
                  {connection?.google_account_email ?? (authenticated ? config.clientEmail : "—")}
                </strong>
              </div>
              <div>
                Authentication:{" "}
                <strong>
                  {connection?.auth_mode === "workspace_oauth"
                    ? "Google Workspace OAuth"
                    : config.authMode === "service_account"
                      ? "Service account"
                      : String(config.authMode ?? "—")}
                </strong>
              </div>
              <div>
                Access: <strong>Read-only</strong>
              </div>
              <div>
                Status: <strong>{connection?.status ?? managerHealth.label}</strong>
              </div>
              <div>
                Last verified:{" "}
                {connection?.last_success_at
                  ? new Date(connection.last_success_at).toLocaleString()
                  : "—"}
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void runAction({ action: "list_shared_drives" })}
              >
                {busyAction === "list_shared_drives" ? "Loading…" : "Browse Google Drive"}
              </Button>
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() => void runAction({ action: "test_auth" })}
              >
                {busyAction === "test_auth" ? "Testing…" : "Test connection"}
              </Button>
              <a href="/api/admin/connectors/google/reconnect">
                <Button type="button" variant="secondary" disabled={busy}>
                  Reconnect
                </Button>
              </a>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDisconnectConfirm(true)}
              >
                Disconnect
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                Advanced details
              </Button>
            </div>
            {connection?.status === "reauthorization_required" ? (
              <p className="mt-3 text-sm text-amber-800">
                Reauthorization required. Click Reconnect and sign in again.
                {connection.last_error_message_safe
                  ? ` (${connection.last_error_message_safe})`
                  : ""}
              </p>
            ) : null}
          </>
        )}

        {disconnectConfirm ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm">
            <p className="font-medium text-red-900">Disconnect Google?</p>
            <p className="mt-1 text-[var(--acton-muted)]">
              Refresh tokens are removed. Google files are never deleted. Knowledge entries stay
              unless you choose to archive them.
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={archiveOnDisconnect}
                onChange={(e) => setArchiveOnDisconnect(e.target.checked)}
              />
              Also archive Google-managed Knowledge entries
            </label>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => void disconnectGoogle()}>
                Confirm disconnect
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDisconnectConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {showOauthSetup ? (
          <div className="mt-4 space-y-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3 text-sm">
            <p className="font-medium">Google Cloud OAuth checklist</p>
            <ol className="list-decimal space-y-1 pl-5 text-[var(--acton-muted)]">
              <li>Select or create the Google Cloud project.</li>
              <li>
                APIs &amp; Services → Library → search <em>Google Drive API</em> (Google Enterprise
                API) → Enable. Repeat for Docs API and Sheets API.
              </li>
              <li>
                Configure OAuth consent screen (Internal if available; else External testing).
              </li>
              <li>Create OAuth Client ID → Web application.</li>
              <li>
                Add redirect URI:{" "}
                <code className="text-xs">
                  https://acton-baxter.vercel.app/api/admin/connectors/google/oauth/callback
                </code>
              </li>
              <li>
                Set Vercel vars: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
                GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY,
                GOOGLE_AUTH_MODE=workspace_oauth
              </li>
              <li>Redeploy, then click Connect Google Workspace as baxter@actonadu.com.</li>
            </ol>
            <p className="text-xs">
              Full guide: <code>docs/google-workspace-oauth-setup.md</code>
            </p>
          </div>
        ) : null}

        {showAdvanced ? (
          <div className="mt-4 space-y-3 rounded-md border border-[var(--acton-border)] p-3 text-sm">
            <p className="font-medium">Service account (advanced)</p>
            <p className="text-[var(--acton-muted)]">
              {config.serviceAccountExternalWarning ??
                "This service account is external to the Acton ADU Workspace unless domain-wide delegation is configured. It may not be able to access Shared Drives restricted to internal members."}
            </p>
            <dl className="grid gap-1 sm:grid-cols-2">
              <div>
                Project ID present: <YesNo value={config.projectIdPresent} />
              </div>
              <div>Client email: {config.clientEmail ?? "—"}</div>
              <div>
                Private key valid: <YesNo value={config.privateKeyFormatValid} />
              </div>
              <div>
                Domain-wide delegation available:{" "}
                <YesNo value={Boolean(config.domainWideDelegationAvailable)} />
              </div>
              <div>Auth mode setting: {config.authMode ?? "workspace_oauth"}</div>
              <div>
                OAuth env configured: <YesNo value={Boolean(config.oauthConfigured)} />
              </div>
            </dl>
          </div>
        ) : null}
      </Card>

      {sharedDrives.length > 0 ? (
        <Card>
          <CardTitle>Shared Drives</CardTitle>
          <CardDescription className="mt-2">
            Visible to the connected Google account. Connect a drive or folder as a Knowledge root
            without pasting IDs.
          </CardDescription>
          <ul className="mt-4 space-y-2">
            {sharedDrives.map((drive) => (
              <li
                key={drive.id}
                className="flex flex-col gap-2 rounded-md border border-[var(--acton-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium text-[var(--acton-navy)]">{drive.name}</div>
                  <div className="text-xs text-[var(--acton-muted)]">Drive ID: {drive.id}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() =>
                      void runAction({ action: "browse_shared_drive", driveId: drive.id })
                    }
                  >
                    Open
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void runAction({ action: "add_folder", folderId: drive.id }).then(() =>
                        setMessage(`Connected Shared Drive “${drive.name}” as a Knowledge root.`),
                      )
                    }
                  >
                    Connect as root
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => void runAction({ action: "browse_my_drive" })}
            >
              Open My Drive
            </Button>
          </div>
        </Card>
      ) : null}

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
        <CardTitle>Safe tests & sync</CardTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runAction({ action: "test_auth" })}>
            {busyAction === "test_auth" ? "Testing…" : "Test credentials"}
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "test_root_folder" })}
          >
            {busyAction === "test_root_folder" ? "Testing…" : "Test root folder"}
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "list_shared_drives" })}
          >
            {busyAction === "list_shared_drives" ? "Loading…" : "List Shared Drives"}
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "list_sample_files" })}
          >
            {busyAction === "list_sample_files" ? "Loading…" : "List sample files"}
          </Button>
          <Button disabled={busy} variant="secondary" onClick={() => void browse()}>
            {busyAction === "browse" ? "Loading…" : "Browse files"}
          </Button>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() => void runAction({ action: "dry_run_sync" })}
          >
            {busyAction === "dry_run_sync" ? "Running…" : "Dry-run sync"}
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
        {message ? <p className="mt-3 text-sm text-[var(--acton-navy)]">{message}</p> : null}
        {friendlyResult ? (
          <div className="mt-4 rounded-md border border-[var(--acton-border)] bg-white p-3 text-sm">
            <div className="font-semibold text-[var(--acton-navy)]">{friendlyResult.title}</div>
            <dl className="mt-2 space-y-1">
              {friendlyResult.lines.map((line) => (
                <div key={line.label}>
                  <span className="text-[var(--acton-muted)]">{line.label}:</span> {line.value}
                </div>
              ))}
            </dl>
            {friendlyResult.guidance?.length ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[var(--acton-muted)]">
                {friendlyResult.guidance.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            <button
              type="button"
              className="mt-3 text-xs font-medium text-[var(--acton-navy)] underline"
              onClick={() => setShowTechnical((v) => !v)}
            >
              {showTechnical ? "Hide technical details" : "View technical details"}
            </button>
            {showTechnical ? (
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs">
                {JSON.stringify(friendlyResult.technical, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Connect Drive root</CardTitle>
        <CardDescription className="mt-2">
          Prefer Shared Drives above. Manual folder URL or ID entry is available for advanced cases.
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
            {busyAction === "add_folder" ? "Adding…" : "Add folder"}
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
