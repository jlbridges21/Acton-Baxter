"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { GhlAdminOverview } from "@/lib/connectors/ghl/diagnostics";

type Tab =
  | "overview"
  | "contacts"
  | "opportunities"
  | "pipelines"
  | "calendars"
  | "conversations"
  | "users"
  | "voice-ai"
  | "advanced";

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

export function GhlConnectorClient({
  initialOverview,
  oauthNotice,
}: {
  initialOverview: GhlAdminOverview;
  oauthNotice?: {
    success?: boolean;
    connectedLocation?: string | null;
    reconnectSuccess?: boolean;
    error?: string | null;
    message?: string | null;
  };
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() => {
    if (oauthNotice?.success) {
      return oauthNotice.connectedLocation
        ? `Connected to ${oauthNotice.connectedLocation}.`
        : "GoHighLevel connected successfully.";
    }
    if (oauthNotice?.reconnectSuccess) {
      return "GoHighLevel reconnected successfully.";
    }
    if (oauthNotice?.error) {
      return oauthNotice.message || "OAuth error.";
    }
    return null;
  });
  const [browseData, setBrowseData] = useState<Record<string, unknown> | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  const config = overview.config;
  const health = overview.health;
  const connection = overview.connection;

  const isConnected = health.overall === "healthy" || health.overall === "warning";

  const refreshOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/connectors/ghl");
      if (response.ok) {
        const data = await response.json();
        setOverview(data);
      }
    } catch (error) {
      console.error("Failed to refresh overview:", error);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setBusy("test_connection");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_connection" }),
      });
      const data = await response.json();
      if (data.result?.pass) {
        setMessage(`Connected: ${data.result.locationName || data.result.locationId}`);
      } else {
        setMessage(`Connection failed: ${data.result?.message || "Unknown error"}`);
      }
      await refreshOverview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setBusy(null);
    }
  }, [refreshOverview]);

  const browseTab = useCallback(async (tab: Tab) => {
    if (tab === "overview" || tab === "advanced") {
      setActiveTab(tab);
      setBrowseData(null);
      return;
    }

    setActiveTab(tab);
    setLoadingBrowse(true);
    setBrowseData(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "browse", tab }),
      });
      const data = await response.json();
      if (data.result?.pass) {
        setBrowseData(data.result.data);
      } else {
        setMessage(`Browse failed: ${data.result?.message || "Unknown error"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Browse failed");
    } finally {
      setLoadingBrowse(false);
    }
  }, []);

  const refreshCache = useCallback(
    async (resourceType?: string) => {
      setBusy("refresh_cache");
      setMessage(null);
      try {
        const response = await fetch("/api/admin/connectors/ghl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "refresh_reference_cache",
            resourceType: resourceType || undefined,
          }),
        });
        const data = await response.json();
        if (data.result?.pass) {
          setMessage(data.result.message);
        } else {
          setMessage(`Cache refresh failed: ${data.result?.message || "Unknown error"}`);
        }
        await refreshOverview();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Cache refresh failed");
      } finally {
        setBusy(null);
      }
    },
    [refreshOverview],
  );

  const disconnect = useCallback(async () => {
    if (
      !confirm("Disconnect GoHighLevel? This will require reconnecting to use the integration.")
    ) {
      return;
    }
    setBusy("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (response.ok) {
        setMessage("GoHighLevel disconnected successfully.");
        await refreshOverview();
      } else {
        const data = await response.json();
        setMessage(`Disconnect failed: ${data.error?.message || "Unknown error"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  }, [refreshOverview]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const healthLabel =
    health.overall === "healthy"
      ? "Connected"
      : health.overall === "warning"
        ? "Partial"
        : health.overall === "not_configured"
          ? "Not Configured"
          : "Offline";

  const healthColor =
    health.overall === "healthy"
      ? "text-emerald-700"
      : health.overall === "warning"
        ? "text-amber-700"
        : health.overall === "not_configured"
          ? "text-[var(--acton-muted)]"
          : "text-red-700";

  const capabilities = [];
  if (health.checks.find((c) => c.check === "contacts" && c.ok)) capabilities.push("Contacts");
  if (health.checks.find((c) => c.check === "opportunities" && c.ok))
    capabilities.push("Opportunities");
  if (health.checks.find((c) => c.check === "pipelines" && c.ok)) capabilities.push("Pipelines");
  if (health.checks.find((c) => c.check === "calendars" && c.ok)) capabilities.push("Calendars");
  if (health.checks.find((c) => c.check === "conversations" && c.ok))
    capabilities.push("Conversations");

  return (
    <div className="min-h-screen bg-[var(--acton-bg)]">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link
                href="/admin/connectors"
                className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
              >
                ← Connectors
              </Link>
            </div>
            <h1 className="text-2xl font-semibold text-[var(--acton-fg)]">GoHighLevel Connector</h1>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              Connect Baxter to Acton&apos;s CRM, contacts, opportunities, and sales pipeline.
            </p>
          </div>
        </div>

        {message && (
          <Card className="border-l-4 border-sky-600 bg-sky-50 p-4">
            <p className="text-sm text-sky-900">{message}</p>
          </Card>
        )}

        <Card className="p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <CardTitle>Connection Status</CardTitle>
              <CardDescription>
                {config.authMode === "private_integration"
                  ? "Using Private Integration Token (env var)"
                  : "Using OAuth"}
              </CardDescription>
            </div>
            <div className={`text-sm font-medium ${healthColor}`}>{healthLabel}</div>
          </div>

          <div className="space-y-3 text-sm">
            {connection && (
              <>
                <div className="flex justify-between">
                  <span className="text-[var(--acton-muted)]">Location</span>
                  <span className="font-medium text-[var(--acton-fg)]">
                    {connection.location_name || connection.location_id}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--acton-muted)]">Status</span>
                  <span className="font-medium text-[var(--acton-fg)]">{connection.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--acton-muted)]">Last Verified</span>
                  <span className="text-[var(--acton-fg)]">
                    {formatWhen(connection.last_verified_at)}
                  </span>
                </div>
              </>
            )}
            {health.locationId && (
              <div className="flex justify-between">
                <span className="text-[var(--acton-muted)]">Location ID</span>
                <span className="font-mono text-xs text-[var(--acton-fg)]">
                  {health.locationId}
                </span>
              </div>
            )}
            {capabilities.length > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--acton-muted)]">Capabilities</span>
                <span className="text-[var(--acton-fg)]">{capabilities.join(", ")}</span>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={testConnection} disabled={busy === "test_connection"} size="sm">
              {busy === "test_connection" ? "Testing..." : "Test Connection"}
            </Button>
            {isConnected && (
              <Button onClick={() => setActiveTab("overview")} variant="secondary" size="sm">
                Browse Data
              </Button>
            )}
            {config.authMode === "oauth" && (
              <>
                {!connection && (
                  <Link href="/api/admin/connectors/ghl/oauth/start">
                    <Button size="sm">Connect GoHighLevel</Button>
                  </Link>
                )}
                {connection && (
                  <>
                    <Link href="/api/admin/connectors/ghl/reconnect">
                      <Button variant="secondary" size="sm">
                        Reconnect
                      </Button>
                    </Link>
                    <Button
                      onClick={disconnect}
                      variant="danger"
                      size="sm"
                      disabled={busy === "disconnect"}
                    >
                      {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>

          {overview.guidance.length > 0 && (
            <div className="mt-4 space-y-1 border-t pt-4">
              <p className="text-xs font-medium text-[var(--acton-muted)]">
                Configuration Guidance:
              </p>
              {overview.guidance.map((item, idx) => (
                <p key={idx} className="text-xs text-[var(--acton-muted)]">
                  • {item}
                </p>
              ))}
            </div>
          )}
        </Card>

        {isConnected && (
          <Card className="p-6">
            <CardTitle className="mb-4">Browse GoHighLevel Data</CardTitle>
            <div className="mb-4 flex gap-2 border-b">
              {(
                [
                  "overview",
                  "contacts",
                  "opportunities",
                  "pipelines",
                  "calendars",
                  "conversations",
                  "users",
                  "advanced",
                ] as Tab[]
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => browseTab(tab)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {activeTab === "overview" && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--acton-muted)]">
                  Use the tabs above to browse contacts, opportunities, pipelines, calendars,
                  conversations, and users from GoHighLevel.
                </p>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-[var(--acton-fg)]">Health Checks</h3>
                  {health.checks.map((check) => (
                    <div key={check.check} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--acton-muted)]">{check.check}</span>
                      <span className={check.ok ? "text-emerald-700" : "text-red-700"}>
                        {check.ok ? "✓ OK" : `✗ ${check.code || "Failed"}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "advanced" && (
              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">
                    Reference Cache
                  </h3>
                  <div className="space-y-2">
                    {overview.cacheStatus.map((cache) => (
                      <div
                        key={cache.resourceType}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-[var(--acton-muted)]">{cache.resourceType}</span>
                        <span className={cache.expired ? "text-amber-700" : "text-emerald-700"}>
                          {cache.exists ? (cache.expired ? "Expired" : "Cached") : "Not cached"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => refreshCache()}
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    disabled={busy === "refresh_cache"}
                  >
                    {busy === "refresh_cache" ? "Refreshing..." : "Clear All Cache"}
                  </Button>
                </div>
              </div>
            )}

            {loadingBrowse && (
              <div className="py-8 text-center text-sm text-[var(--acton-muted)]">Loading...</div>
            )}

            {!loadingBrowse && browseData && (
              <div className="space-y-2">
                <pre className="max-h-96 overflow-auto rounded bg-slate-100 p-4 text-xs">
                  {JSON.stringify(browseData, null, 2)}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
