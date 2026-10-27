"use client";

/**
 * /reports/settings (admins): JobTread connection, sync, field access categories, and the
 * business vocabulary mapping. The grant key is never sent to the browser.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  PlugZap,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatDateTime,
  formatRelative,
  Notice,
  selectClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BusinessFields } from "./business-fields";
import { RegionMappings } from "./region-mappings";
import { SyncManager } from "./sync-manager";

type Overview = {
  configured: boolean;
  connection: {
    status: string;
    organizationId: string | null;
    organizationName: string | null;
    grantName: string | null;
    grantExpiresAt: string | null;
    grantExpiresInDays: number | null;
    grantIsUnrestricted: boolean | null;
    lastTestedAt: string | null;
    lastError: string | null;
    syncIntervalMinutes: number;
    scheduledSyncEnabled: boolean;
  };
  counts: { jobs: number; models: number };
  runs: Array<{
    id: string;
    status: string;
    triggered_by: string;
    started_at: string;
    duration_ms: number | null;
    api_requests: number;
    records_seen: number;
    records_removed: number;
    error: string | null;
  }>;
  fields: Array<{
    id: string;
    name: string;
    displayName: string | null;
    description: string | null;
    type: string;
    target: string;
    category: string;
    options: string[];
    filled: number;
  }>;
  semantic: Array<{
    key: string;
    label: string;
    description: string | null;
    customFieldId: string | null;
    updatedAt: string;
  }>;
};

const CATEGORIES = [
  { value: "general", label: "Project info (everyone)" },
  { value: "customer", label: "Customer details" },
  { value: "financial", label: "Financial" },
  { value: "internal", label: "Internal notes" },
  { value: "excluded", label: "Excluded" },
];

export function DataSettings() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldQuery, setFieldQuery] = useState("");
  const [target, setTarget] = useState("all");

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Overview>("/api/reports/admin/jobtread"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const call = async (key: string, url: string, method: string, body: unknown) => {
    setBusy(key);
    setError(null);
    try {
      setData(await aiFetch<Overview>(url, { method, body: JSON.stringify(body) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const fieldsShown = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return (data?.fields ?? []).filter(
      (f) =>
        (target === "all" || f.target === target) &&
        (!q || `${f.name} ${f.displayName ?? ""} ${f.id}`.toLowerCase().includes(q)),
    );
  }, [data, fieldQuery, target]);
  if (!data) {
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading…</p>
    );
  }
  const c = data.connection;
  const lastRun = data.runs[0];
  const expiresSoon = c.grantExpiresInDays !== null && c.grantExpiresInDays < 21;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Reports
        </Link>
        <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Reports data settings</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
              JobTread connection (read-only), sync, and which fields each person can see in
              reports.
            </p>
          </div>
          <Link
            href="/reports/settings/cost-items"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-[var(--acton-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] md:self-auto"
          >
            <Boxes className="h-4 w-4" aria-hidden /> Cost items & models
          </Link>
          <Link
            href="/reports/settings/health"
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-[var(--acton-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] md:self-auto"
          >
            <Activity className="h-4 w-4" aria-hidden /> Data health
          </Link>
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
            <PlugZap className="h-4 w-4" aria-hidden /> JobTread connection
          </h2>
          {!data.configured ? (
            <Notice tone="warning" className="mt-3">
              JOBTREAD_GRANT_KEY isn&apos;t set on the server. Add it to the environment (never in
              the browser or in git), then test the connection.
            </Notice>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Status</dt>
              <dd
                className={cn(
                  "inline-flex items-center gap-1 font-semibold",
                  c.status === "connected"
                    ? "text-emerald-700"
                    : c.status === "error"
                      ? "text-red-700"
                      : "text-[var(--acton-navy)]",
                )}
              >
                {c.status === "connected" ? (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                ) : c.status === "error" ? (
                  <TriangleAlert className="h-4 w-4" aria-hidden />
                ) : null}
                {c.status === "connected"
                  ? "Connected"
                  : c.status === "error"
                    ? "Error"
                    : c.status === "not_configured"
                      ? "Not configured"
                      : "Not tested"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Organization</dt>
              <dd className="font-medium text-[var(--acton-navy)]">
                {c.organizationName ?? "—"}{" "}
                {c.organizationId ? (
                  <span className="text-xs text-[var(--acton-muted)]">({c.organizationId})</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Grant</dt>
              <dd className="font-medium text-[var(--acton-navy)]">{c.grantName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Grant expires</dt>
              <dd
                className={cn(
                  "font-medium",
                  expiresSoon ? "text-amber-800" : "text-[var(--acton-navy)]",
                )}
              >
                {c.grantExpiresAt ? formatDateTime(c.grantExpiresAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Last tested</dt>
              <dd className="text-[var(--acton-navy)]">{formatRelative(c.lastTestedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Mode</dt>
              <dd className="text-[var(--acton-navy)]">Read-only (writes are blocked in code)</dd>
            </div>
          </dl>
          {c.grantIsUnrestricted ? (
            <Notice tone="warning" className="mt-3">
              This grant has no action restrictions in JobTread. Baxter only sends read queries, but
              a grant limited to read access is safer. JobTread grants expire after 3 months without
              use.
            </Notice>
          ) : null}
          {c.lastError ? (
            <Notice tone="error" className="mt-3">
              {c.lastError}
            </Notice>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void call("test", "/api/reports/admin/jobtread", "POST", { action: "test" })
              }
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
            <RefreshCw className="h-4 w-4" aria-hidden /> Core sync (frequent)
          </h2>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Refreshes the core datasets (custom fields, jobs, documents, Product Library models)
            together at the interval below. Every other dataset is managed in the Sync manager.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Cached</dt>
              <dd className="font-medium text-[var(--acton-navy)]">
                {data.counts.jobs.toLocaleString()} jobs · {data.counts.models.toLocaleString()}{" "}
                models
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Last sync</dt>
              <dd className="font-medium text-[var(--acton-navy)]">
                {lastRun ? `${lastRun.status} · ${formatRelative(lastRun.started_at)}` : "Never"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--acton-muted)]">Scheduled sync</dt>
              <dd className="text-[var(--acton-navy)]">
                {c.scheduledSyncEnabled ? "On" : "Off (set JOBTREAD_SYNC_ENABLED=true)"}
              </dd>
            </div>
            <div>
              <label htmlFor="interval" className="text-xs text-[var(--acton-muted)]">
                Interval
              </label>
              <select
                id="interval"
                className={`${selectClass} h-9`}
                value={c.syncIntervalMinutes}
                disabled={busy !== null}
                onChange={(e) =>
                  void call("interval", "/api/reports/admin/jobtread", "POST", {
                    action: "interval",
                    minutes: Number(e.target.value),
                  })
                }
              >
                {[15, 30, 60, 120, 240, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    Every {m < 60 ? `${m} min` : `${m / 60} hr`}
                  </option>
                ))}
              </select>
            </div>
          </dl>
          <div className="mt-4">
            <Button
              size="sm"
              disabled={busy !== null || !data.configured}
              onClick={() =>
                void call("sync", "/api/reports/admin/jobtread", "POST", { action: "sync" })
              }
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          {data.runs.length ? (
            <ul className="mt-4 divide-y divide-[var(--acton-gray-100)] text-xs">
              {data.runs.slice(0, 6).map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-1.5">
                  <span
                    className={cn(
                      "font-semibold",
                      r.status === "failed" ? "text-red-700" : "text-[var(--acton-navy)]",
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="text-[var(--acton-muted)]">
                    {formatDateTime(r.started_at)} · {r.records_seen} records · {r.api_requests} API
                    calls{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""}
                  </span>
                  {r.error ? (
                    <span className="truncate text-red-700" title={r.error}>
                      {r.error}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <SyncManager />

      <BusinessFields />

      <RegionMappings />

      <section className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="font-semibold text-[var(--acton-navy)]">JobTread fields &amp; access</h2>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              Customer, financial, and internal fields are only shown to people granted that access
              on Dexter&apos;s Access tab. Excluded fields are never used. Vendor and contact fields
              start excluded; their values are cached by the Accounts and Contacts datasets on the
              next sync after you allow them.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Field target"
              className={`${selectClass} h-9 w-36`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="all">All targets</option>
              <option value="job">Job</option>
              <option value="location">Location</option>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
              <option value="contact">Contact</option>
            </select>
            <input
              aria-label="Search fields"
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Search fields"
              className="h-9 w-56 rounded-md border border-[var(--acton-border)] px-3 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--acton-muted)]">
              <tr>
                <th className="py-2 pr-3 font-semibold">Field</th>
                <th className="py-2 pr-3 font-semibold">Target</th>
                <th className="py-2 pr-3 font-semibold">Type</th>
                <th className="py-2 pr-3 text-right font-semibold">Filled</th>
                <th className="py-2 pr-3 font-semibold">Access</th>
              </tr>
            </thead>
            <tbody>
              {fieldsShown.map((f) => (
                <tr key={f.id} className="border-t border-[var(--acton-gray-100)]">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-[var(--acton-navy)]">
                      {f.displayName || f.name}
                    </p>
                    <p className="text-xs text-[var(--acton-muted)]">{f.id}</p>
                  </td>
                  <td className="py-2 pr-3 capitalize">{f.target}</td>
                  <td className="py-2 pr-3">{f.type}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {f.filled}/
                    {f.target === "job" || f.target === "location" || f.target === "customer"
                      ? data.counts.jobs
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      aria-label={`Access for ${f.name}`}
                      className={`${selectClass} h-9 w-52`}
                      value={f.category}
                      disabled={busy !== null}
                      onChange={(e) =>
                        void call(`f-${f.id}`, "/api/reports/admin/fields", "PATCH", {
                          id: f.id,
                          category: e.target.value,
                        })
                      }
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {fieldsShown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-[var(--acton-muted)]">
                    {data.fields.length ? "No fields match." : "No fields yet — run a sync."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
