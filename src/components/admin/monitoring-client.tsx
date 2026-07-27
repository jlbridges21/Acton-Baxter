"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle,
  Play,
  Settings as SettingsIcon,
  XCircle,
  Eye,
} from "lucide-react";

type Tab = "overview" | "findings" | "runs" | "settings" | "mappings";

type FindingStatus = "open" | "acknowledged" | "resolved" | "false_positive";

type Finding = {
  id: string;
  check_key: string;
  status: FindingStatus;
  severity: string;
  title: string;
  description: string;
  context: Record<string, unknown>;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  notes: string | null;
};

type MonitoringRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  findings_detected: number;
  checks_run: number;
  error_message: string | null;
};

type DashboardSummary = {
  enabled: boolean;
  lastSweepAt: string | null;
  openFindings: number;
  acknowledgedFindings: number;
  resolvedToday: number;
  falsePositiveRate: number;
  connectorStatus: string;
  rulebookStatus: string;
};

type MonitoringSettings = {
  enabled: boolean;
  slack_channel_id: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  delivery_mode: string;
  escalation_minutes: number;
  stale_opportunity_days: number;
  monitored_pipelines: string[];
  check_configs: Record<string, Record<string, unknown>>;
};

type Mapping = {
  id: string;
  ghl_pipeline_id: string;
  ghl_pipeline_name: string | null;
  ghl_stage_id: string;
  ghl_stage_name: string | null;
  rulebook_stage_key: string;
  rulebook_step_key: string | null;
  enabled: boolean;
};

type GHLPipeline = {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
  }>;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
  { id: "mappings", label: "Mappings" },
];

function formatDate(iso: string | null | undefined) {
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

function formatDuration(startIso: string, endIso: string | null) {
  if (!endIso) return "Running...";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      className={`fixed right-4 bottom-4 rounded-lg px-4 py-3 shadow-lg ${
        type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
      }`}
    >
      {message}
    </div>
  );
}

export function MonitoringClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  const [runs, setRuns] = useState<MonitoringRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [sweepLoading, setSweepLoading] = useState(false);

  const [settings, setSettings] = useState<MonitoringSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [pipelines, setPipelines] = useState<GHLPipeline[]>([]);

  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/monitoring");
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to load summary");
      }
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadSummary();
    });
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  const loadFindings = async () => {
    setFindingsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_findings" }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load findings");

      setFindings(data.findings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setFindingsLoading(false);
    }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_runs", limit: 50 }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load runs");

      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setRunsLoading(false);
    }
  };

  const handleRunSweep = async () => {
    setSweepLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_sweep", force: true }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to run sweep");

      showToast("Monitoring sweep completed", "success");
      await loadSummary();
      if (tab === "runs") await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Sweep failed", "error");
    } finally {
      setSweepLoading(false);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    setError(null);

    try {
      const [settingsRes, pipelinesRes] = await Promise.all([
        fetch("/api/admin/baxter/monitoring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_settings" }),
        }),
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_ghl_pipelines" }),
        }),
      ]);

      const settingsData = await settingsRes.json();
      const pipelinesData = await pipelinesRes.json();

      if (!settingsData.success) throw new Error("Failed to load settings");

      setSettings(settingsData.settings);
      if (pipelinesData.success) {
        setPipelines(pipelinesData.pipelines || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleUpdateSettings = async (patch: Partial<MonitoringSettings>) => {
    if (!settings) return;

    try {
      const res = await fetch("/api/admin/baxter/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", patch }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to update settings");

      setSettings(data.settings);
      showToast("Settings updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
    }
  };

  const handleToggleMonitoredPipeline = async (pipelineId: string, enabled: boolean) => {
    if (!settings) return;

    const newMonitoredPipelines = enabled
      ? [...settings.monitored_pipelines, pipelineId]
      : settings.monitored_pipelines.filter((id) => id !== pipelineId);

    await handleUpdateSettings({ monitored_pipelines: newMonitoredPipelines });
  };

  const loadMappings = async () => {
    setMappingsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_mappings" }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load mappings");

      setMappings(data.mappings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load mappings", "error");
    } finally {
      setMappingsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Process Monitoring</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Process Monitoring</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Automated compliance checks for opportunities against the process rulebook
        </p>
      </div>

      {error && (
        <Card className="border-red-500 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </Card>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === "findings") void loadFindings();
              if (t.id === "runs") void loadRuns();
              if (t.id === "settings") void loadSettings();
              if (t.id === "mappings") void loadMappings();
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && summary && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                Status
                {summary.enabled ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-gray-400" />
                )}
              </CardTitle>
              <CardDescription className="mt-2 text-lg font-bold text-[var(--acton-navy)]">
                {summary.enabled ? "Enabled" : "Disabled"}
              </CardDescription>
            </Card>

            <Card className="p-4">
              <CardTitle className="text-sm">Last Sweep</CardTitle>
              <CardDescription className="mt-2 text-sm text-[var(--acton-navy)]">
                {formatDate(summary.lastSweepAt)}
              </CardDescription>
            </Card>

            <Card className="p-4">
              <CardTitle className="text-sm">Open Findings</CardTitle>
              <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                {summary.openFindings}
              </CardDescription>
              {summary.acknowledgedFindings > 0 && (
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {summary.acknowledgedFindings} acknowledged
                </p>
              )}
            </Card>

            <Card className="p-4">
              <CardTitle className="text-sm">Resolved Today</CardTitle>
              <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                {summary.resolvedToday}
              </CardDescription>
              {summary.falsePositiveRate > 0 && (
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {(summary.falsePositiveRate * 100).toFixed(1)}% false positive rate
                </p>
              )}
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <CardTitle className="text-sm">Connector Status</CardTitle>
              <CardDescription className="mt-2 text-sm">
                {summary.connectorStatus || "Unknown"}
              </CardDescription>
            </Card>

            <Card className="p-4">
              <CardTitle className="text-sm">Rulebook Status</CardTitle>
              <CardDescription className="mt-2 text-sm">
                {summary.rulebookStatus || "Unknown"}
              </CardDescription>
            </Card>
          </div>

          <Card className="p-4">
            <CardTitle className="mb-3">Actions</CardTitle>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleRunSweep} disabled={sweepLoading} variant="primary">
                <Play className="mr-2 h-4 w-4" />
                {sweepLoading ? "Running..." : "Run Sweep Now"}
              </Button>
              <Button onClick={() => setTab("findings")} variant="secondary">
                <AlertCircle className="mr-2 h-4 w-4" />
                View Findings
              </Button>
              <Button onClick={() => setTab("settings")} variant="secondary">
                <SettingsIcon className="mr-2 h-4 w-4" />
                Configure
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "findings" && (
        <div className="space-y-6">
          {findingsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading findings...</p>
          ) : findings.length === 0 ? (
            <Card className="p-6">
              <CardTitle className="mb-2">No Findings</CardTitle>
              <CardDescription>
                All opportunities are compliant with the process rulebook.
              </CardDescription>
            </Card>
          ) : (
            <>
              <div className="grid gap-4">
                {findings.map((finding) => (
                  <Card
                    key={finding.id}
                    className={`p-4 ${
                      selectedFinding?.id === finding.id ? "ring-2 ring-[var(--acton-navy)]" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{finding.title}</CardTitle>
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              finding.severity === "high"
                                ? "bg-red-100 text-red-800"
                                : finding.severity === "medium"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {finding.severity}
                          </span>
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ${
                              finding.status === "open"
                                ? "bg-red-100 text-red-800"
                                : finding.status === "acknowledged"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : finding.status === "resolved"
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {finding.status}
                          </span>
                        </div>
                        <CardDescription className="mt-1 text-sm">
                          {finding.description}
                        </CardDescription>
                        <p className="mt-2 text-xs text-[var(--acton-muted)]">
                          Detected: {formatDate(finding.detected_at)}
                          {finding.acknowledged_at &&
                            ` • Acknowledged: ${formatDate(finding.acknowledged_at)}`}
                          {finding.resolved_at && ` • Resolved: ${formatDate(finding.resolved_at)}`}
                        </p>
                        {finding.notes && (
                          <p className="mt-2 text-xs text-[var(--acton-muted)] italic">
                            Note: {finding.notes}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() =>
                          setSelectedFinding(selectedFinding?.id === finding.id ? null : finding)
                        }
                        variant="ghost"
                        size="sm"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>

                    {selectedFinding?.id === finding.id && (
                      <div className="mt-4 rounded bg-gray-50 p-3">
                        <p className="mb-2 text-xs font-semibold text-[var(--acton-navy)]">
                          Context:
                        </p>
                        <pre className="overflow-x-auto text-xs">
                          {JSON.stringify(finding.context, null, 2)}
                        </pre>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "runs" && (
        <div className="space-y-6">
          {runsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading runs...</p>
          ) : runs.length === 0 ? (
            <Card className="p-6">
              <CardTitle className="mb-2">No Runs</CardTitle>
              <CardDescription>No monitoring sweeps have been executed yet.</CardDescription>
            </Card>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Card key={run.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">
                          Run {new Date(run.started_at).toLocaleString()}
                        </CardTitle>
                        <span
                          className={`rounded px-2 py-1 text-xs font-semibold ${
                            run.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : run.status === "failed"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <CardDescription className="mt-1 text-sm">
                        Duration: {formatDuration(run.started_at, run.completed_at)} • Checks:{" "}
                        {run.checks_run} • Findings: {run.findings_detected}
                      </CardDescription>
                      {run.error_message && (
                        <p className="mt-2 text-xs text-red-600">{run.error_message}</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-6">
          {settingsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading settings...</p>
          ) : !settings ? (
            <Card className="p-4">
              <CardDescription>Failed to load settings</CardDescription>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <CardTitle className="mb-4">General Settings</CardTitle>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--acton-navy)]">
                        Enable Monitoring
                      </p>
                      <p className="text-xs text-[var(--acton-muted)]">
                        Run automated compliance checks
                      </p>
                    </div>
                    <label className="relative inline-block h-6 w-11">
                      <input
                        type="checkbox"
                        checked={settings.enabled}
                        onChange={(e) => handleUpdateSettings({ enabled: e.target.checked })}
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 cursor-pointer rounded-full bg-gray-300 transition peer-checked:bg-[var(--acton-navy)]" />
                      <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                      Slack Channel ID
                    </label>
                    <input
                      type="text"
                      value={settings.slack_channel_id || ""}
                      onChange={(e) => handleUpdateSettings({ slack_channel_id: e.target.value })}
                      placeholder="C1234567890"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-[var(--acton-muted)]">
                      Channel where alerts will be posted
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                        Quiet Hours Start
                      </label>
                      <input
                        type="time"
                        value={settings.quiet_hours_start || ""}
                        onChange={(e) =>
                          handleUpdateSettings({ quiet_hours_start: e.target.value })
                        }
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                        Quiet Hours End
                      </label>
                      <input
                        type="time"
                        value={settings.quiet_hours_end || ""}
                        onChange={(e) => handleUpdateSettings({ quiet_hours_end: e.target.value })}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={settings.timezone || ""}
                      onChange={(e) => handleUpdateSettings({ timezone: e.target.value })}
                      placeholder="America/New_York"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                      Delivery Mode
                    </label>
                    <select
                      value={settings.delivery_mode}
                      onChange={(e) => handleUpdateSettings({ delivery_mode: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="immediate">Immediate</option>
                      <option value="digest">Digest</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                        Escalation Minutes
                      </label>
                      <input
                        type="number"
                        value={settings.escalation_minutes}
                        onChange={(e) =>
                          handleUpdateSettings({ escalation_minutes: parseInt(e.target.value) })
                        }
                        min="0"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-[var(--acton-muted)]">
                        Minutes before escalating unacknowledged findings
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                        Stale Opportunity Days
                      </label>
                      <input
                        type="number"
                        value={settings.stale_opportunity_days}
                        onChange={(e) =>
                          handleUpdateSettings({ stale_opportunity_days: parseInt(e.target.value) })
                        }
                        min="0"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-[var(--acton-muted)]">
                        Days before flagging opportunities as stale
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <CardTitle className="mb-4">Monitored Pipelines</CardTitle>
                <CardDescription className="mb-3">
                  Select which GoHighLevel pipelines to monitor for compliance
                </CardDescription>
                <div className="space-y-2">
                  {pipelines.map((pipeline) => {
                    const isMonitored = settings.monitored_pipelines.includes(pipeline.id);
                    return (
                      <div
                        key={pipeline.id}
                        className="flex items-center gap-3 rounded border border-gray-200 p-3"
                      >
                        <input
                          type="checkbox"
                          checked={isMonitored}
                          onChange={(e) =>
                            handleToggleMonitoredPipeline(pipeline.id, e.target.checked)
                          }
                          id={`pipeline-${pipeline.id}`}
                          className="h-4 w-4"
                        />
                        <label
                          htmlFor={`pipeline-${pipeline.id}`}
                          className="flex-1 cursor-pointer text-sm font-medium text-[var(--acton-navy)]"
                        >
                          {pipeline.name}
                          <span className="ml-2 text-xs text-[var(--acton-muted)]">
                            ({pipeline.stages.length} stages)
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "mappings" && (
        <div className="space-y-6">
          {mappingsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading mappings...</p>
          ) : mappings.length === 0 ? (
            <Card className="p-4">
              <CardDescription>
                No GHL mappings configured.{" "}
                <Link
                  href="/admin/baxter/rulebook?tab=mappings"
                  className="text-[var(--acton-navy)] underline"
                >
                  Configure mappings in Rulebook →
                </Link>
              </CardDescription>
            </Card>
          ) : (
            <div className="space-y-3">
              {mappings.map((mapping) => (
                <Card key={mapping.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base">
                        {mapping.ghl_pipeline_name || mapping.ghl_pipeline_id} →{" "}
                        {mapping.ghl_stage_name || mapping.ghl_stage_id}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Maps to: {mapping.rulebook_stage_key}
                        {mapping.rulebook_step_key && ` / ${mapping.rulebook_step_key}`}
                      </CardDescription>
                      {!mapping.enabled && <p className="mt-1 text-xs text-yellow-600">Disabled</p>}
                    </div>
                  </div>
                </Card>
              ))}
              <Card className="p-4">
                <CardDescription>
                  <Link
                    href="/admin/baxter/rulebook"
                    className="text-[var(--acton-navy)] underline"
                  >
                    Manage mappings in Process Rulebook →
                  </Link>
                </CardDescription>
              </Card>
            </div>
          )}
        </div>
      )}

      <p className="text-sm">
        <Link
          href="/admin/baxter/governance"
          className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
        >
          ← Back to Governance
        </Link>
      </p>
    </div>
  );
}
