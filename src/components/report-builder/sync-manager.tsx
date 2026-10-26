"use client";

/**
 * Sync Manager (Reports → Data settings, admins): every JobTread dataset Baxter can cache,
 * with status, inventory, enable/disable, schedule, manual sync, retry, and run history.
 * The server decides everything; this view only sends actions and shows results.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Database, RotateCcw } from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatDateTime,
  formatRelative,
  Notice,
  Pill,
  selectClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EntityStatus =
  | "not_configured"
  | "ready"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "partial"
  | "disabled"
  | "permission_blocked";

type Entity = {
  key: string;
  label: string;
  description: string;
  kind: "core" | "paged";
  sensitivity: "general" | "customer" | "financial" | "internal";
  privacy: string;
  usedFor: string;
  dependsOn: string[];
  enabled: boolean;
  schedule: "daily" | "manual";
  status: EntityStatus;
  lastSuccessAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  recordsCached: number | null;
  sourceCount: number | null;
  sourceVerifiedAt: string | null;
  droppedFields: string[];
  activeRun: { id: string; status: string; pages: number; recordsSeen: number } | null;
};

type Run = {
  id: string;
  entity: string;
  status: string;
  triggeredBy: string;
  jobId: string | null;
  pages: number;
  recordsSeen: number;
  recordsRemoved: number;
  apiRequests: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  resumedFrom: string | null;
  error: string | null;
};

type Overview = {
  configured: boolean;
  schedule: {
    dailyEnabled: boolean;
    dailyHourUtc: number;
    lastDailyEnqueuedAt: string | null;
    nextRunAt: string | null;
    killSwitch: boolean;
  };
  entities: Entity[];
  runs: Run[];
  outcome?: { message: string };
};

export const STATUS_STYLE: Record<EntityStatus | string, { label: string; tone: string }> = {
  not_configured: { label: "Not configured", tone: "bg-slate-100 text-slate-700" },
  ready: { label: "Ready", tone: "bg-sky-50 text-sky-800" },
  queued: { label: "Queued", tone: "bg-indigo-50 text-indigo-800" },
  running: { label: "Running", tone: "bg-indigo-100 text-indigo-900" },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-800" },
  partial: { label: "Partial", tone: "bg-amber-50 text-amber-900" },
  disabled: { label: "Disabled", tone: "bg-slate-100 text-slate-600" },
  permission_blocked: { label: "Permission blocked", tone: "bg-red-100 text-red-900" },
  cancelled: { label: "Cancelled", tone: "bg-slate-100 text-slate-600" },
};

const SENSITIVITY: Record<Entity["sensitivity"], string> = {
  general: "Project info",
  customer: "Customer data",
  financial: "Financial",
  internal: "Internal",
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, tone: "bg-slate-100 text-slate-700" };
  return <Pill className={s.tone}>{s.label}</Pill>;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function SyncManager() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Overview>("/api/reports/admin/sync"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  // Poll while anything is queued or running.
  const active = data?.entities.some((e) => e.activeRun) ?? false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await aiFetch<Overview>("/api/reports/admin/sync", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setData(next);
      setNotice(next.outcome?.message ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data)
    return (
      <section className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <p className="text-sm text-[var(--acton-muted)]">Loading sync manager…</p>
        )}
      </section>
    );
  const s = data.schedule;

  return (
    <section
      aria-labelledby="sync-manager-title"
      className="rounded-lg border border-[var(--acton-border)] bg-white p-5"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2
            id="sync-manager-title"
            className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]"
          >
            <Database className="h-4 w-4" aria-hidden /> Sync manager
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            Each JobTread dataset syncs on its own, in resumable chunks. A failed or partial run
            keeps the last good data — records are only removed after a complete pass.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy !== null || !data.configured}
          onClick={() => void act("all", { action: "sync_all" })}
        >
          {busy === "all" ? "Queuing…" : "Sync all enabled"}
        </Button>
      </div>

      {!data.configured ? (
        <Notice tone="warning" className="mt-3">
          JobTread isn&apos;t connected (JOBTREAD_GRANT_KEY is not set), so nothing can sync.
        </Notice>
      ) : null}
      {s.killSwitch ? (
        <Notice tone="warning" className="mt-3">
          The daily sync is paused on the server (JOBTREAD_DAILY_SYNC=off).
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-3">
          {notice}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-md bg-[var(--acton-gray-50)] p-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.dailyEnabled}
            disabled={busy !== null}
            onChange={(e) =>
              void act("daily", { action: "settings", dailyEnabled: e.target.checked })
            }
          />
          <span className="font-medium text-[var(--acton-navy)]">Daily sync</span>
        </label>
        <div>
          <label htmlFor="daily-hour" className="block text-xs text-[var(--acton-muted)]">
            Runs at (UTC)
          </label>
          <select
            id="daily-hour"
            className={`${selectClass} h-9 w-28`}
            value={s.dailyHourUtc}
            disabled={busy !== null || !s.dailyEnabled}
            onChange={(e) =>
              void act("hour", { action: "settings", dailyHourUtc: Number(e.target.value) })
            }
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-[var(--acton-muted)]">
          Next run: {s.nextRunAt ? formatDateTime(s.nextRunAt) : "off"} · Last queued:{" "}
          {formatRelative(s.lastDailyEnqueuedAt)}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-left text-xs text-[var(--acton-muted)]">
            <tr>
              <th className="py-2 pr-3 font-semibold">Dataset</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 text-right font-semibold">Cached / JobTread</th>
              <th className="py-2 pr-3 font-semibold">Last good sync</th>
              <th className="py-2 pr-3 font-semibold">Schedule</th>
              <th className="py-2 pr-3 font-semibold">Enabled</th>
              <th className="py-2 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entities.map((e) => {
              const expanded = open === e.key;
              const runs = data.runs.filter((r) => r.entity === e.key).slice(0, 8);
              const canRetry = ["failed", "partial", "permission_blocked"].includes(e.status);
              return (
                <Fragment key={e.key}>
                  <tr className="border-t border-[var(--acton-gray-100)] align-top">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : e.key)}
                        aria-expanded={expanded}
                        className="flex items-start gap-1 text-left"
                      >
                        {expanded ? (
                          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        )}
                        <span>
                          <span className="font-medium text-[var(--acton-navy)]">{e.label}</span>
                          <span className="block text-xs text-[var(--acton-muted)]">
                            {SENSITIVITY[e.sensitivity]} · {e.kind === "core" ? "core" : "chunked"}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={e.status} />
                      {e.activeRun ? (
                        <p className="mt-1 text-xs text-[var(--acton-muted)]">
                          {e.activeRun.recordsSeen.toLocaleString()} records · page{" "}
                          {e.activeRun.pages}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {e.recordsCached?.toLocaleString() ?? "—"} /{" "}
                      {e.sourceCount?.toLocaleString() ?? "?"}
                    </td>
                    <td className="py-2 pr-3">{formatRelative(e.lastSuccessAt)}</td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Schedule for ${e.label}`}
                        className={`${selectClass} h-8 w-28 text-xs`}
                        value={e.schedule}
                        disabled={busy !== null}
                        onChange={(ev) =>
                          void act(`sched-${e.key}`, {
                            action: "schedule",
                            entity: e.key,
                            schedule: ev.target.value,
                          })
                        }
                      >
                        <option value="daily">Daily</option>
                        <option value="manual">Manual</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Sync ${e.label}`}
                        checked={e.enabled}
                        disabled={busy !== null}
                        onChange={(ev) =>
                          void act(`en-${e.key}`, {
                            action: "enable",
                            entity: e.key,
                            enabled: ev.target.checked,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {canRetry ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy !== null || !e.enabled || !data.configured}
                          onClick={() =>
                            void act(`retry-${e.key}`, { action: "retry", entity: e.key })
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          {busy === `retry-${e.key}` ? "Retrying…" : "Retry"}
                        </Button>
                      ) : null}{" "}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          busy !== null || !e.enabled || !data.configured || Boolean(e.activeRun)
                        }
                        onClick={() =>
                          void act(`sync-${e.key}`, { action: "sync", entities: [e.key] })
                        }
                      >
                        {busy === `sync-${e.key}` ? "Queuing…" : "Sync"}
                      </Button>
                    </td>
                  </tr>
                  {e.lastError && !expanded ? (
                    <tr>
                      <td colSpan={7} className="pb-2 pl-6 text-xs">
                        <span
                          className={cn(
                            e.lastErrorCode === "SHRINK_GUARD" ? "text-amber-800" : "text-red-700",
                          )}
                        >
                          {e.lastError}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {expanded ? (
                    <tr>
                      <td colSpan={7} className="bg-[var(--acton-gray-50)] px-6 py-3 text-xs">
                        <p className="text-[var(--acton-navy)]">{e.description}</p>
                        <p className="mt-1 text-[var(--acton-muted)]">
                          <strong>Privacy:</strong> {e.privacy}
                        </p>
                        <p className="mt-1 text-[var(--acton-muted)]">
                          <strong>Used for:</strong> {e.usedFor}
                        </p>
                        {e.dependsOn.length ? (
                          <p className="mt-1 text-[var(--acton-muted)]">
                            <strong>Syncs after:</strong> {e.dependsOn.join(", ")}
                          </p>
                        ) : null}
                        {e.droppedFields.length ? (
                          <p className="mt-1 text-amber-800">
                            JobTread doesn&apos;t expose these fields to this grant, so they&apos;re
                            left blank: {e.droppedFields.join(", ")}
                          </p>
                        ) : null}
                        {e.lastError ? <p className="mt-1 text-red-700">{e.lastError}</p> : null}
                        <p className="mt-1 text-[var(--acton-muted)]">
                          JobTread count verified {formatRelative(e.sourceVerifiedAt)} (Data
                          catalog).
                        </p>
                        <h3 className="mt-3 font-semibold text-[var(--acton-navy)]">History</h3>
                        {runs.length ? (
                          <ul className="mt-1 divide-y divide-[var(--acton-gray-100)]">
                            {runs.map((r) => (
                              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                                <StatusPill status={r.status} />
                                <span>
                                  {formatDateTime(r.startedAt ?? r.createdAt)} ·{" "}
                                  {r.recordsSeen.toLocaleString()} records · {r.pages} pages ·{" "}
                                  {r.recordsRemoved} removed · {r.apiRequests} API calls ·{" "}
                                  {r.triggeredBy}
                                  {r.resumedFrom ? " · resumed" : ""}
                                </span>
                                <span className="text-[var(--acton-muted)]">run {r.id}</span>
                                {r.error ? (
                                  <span className="w-full text-red-700">{r.error}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[var(--acton-muted)]">No runs yet.</p>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
