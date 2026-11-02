"use client";

/**
 * /reports/settings/financial (admins): readiness of JobTread financial reporting, document
 * status mapping, balance policy, payments backfill, Project Manager completeness, PP#
 * milestone mapping, weekly snapshots, and alert rules. Nothing here writes to JobTread.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  ClipboardCheck,
  Landmark,
  Milestone,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import { aiFetch, errorMessage, formatRelative, Notice, Pill, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";

type Area = { key: string; label: string; state: string; detail: string; setting: string };
type InventoryRow = { type: string; status: string; count: number; lifecycle: string };
type PreviewItem = {
  documentId: string;
  number: string | null;
  name: string | null;
  jobId: string | null;
  pp: string;
  match: {
    status: string;
    taskId?: string;
    candidates?: Array<{ id: string; name: string | null }>;
    reason?: string;
  };
  link: { status: string; task_id: string | null } | null;
};
type Overview = {
  areas: Area[];
  counts: Record<string, number>;
  totals: {
    invoiced: number | null;
    paid: number | null;
    outstanding: number | null;
    overdue: number | null;
    completeness: string;
    reasons: string[];
  };
  statusInventory: InventoryRow[];
  diagnostics: {
    diagnostics: Array<{ key: string; label: string; count: number; detail: string }>;
    disclaimer: string;
  };
  pm: {
    completenessPct: number | null;
    populated: number;
    totalJobs: number;
    byPm: Array<{ pm: string; jobs: number }>;
    valuesOutsideOptions: Array<{ value: string; jobs: number }>;
    defects: Array<{ class: string; message: string }>;
    blankOpenJobs: Array<{ id: string; name: string; phase: string | null }>;
  } | null;
  settings: {
    statusMap: Array<{ type: string; status: string; lifecycle: string }>;
    balanceSource: string;
    overdueGraceDays: number;
    migrated: boolean;
  };
  paymentsState: { enabled: boolean; lastSucceededAt: string | null; sourceCount: number | null };
  pp: { config: Record<string, unknown>; version: number; migrated: boolean };
  snapshots: {
    settings: {
      enabled: boolean;
      weekday: number;
      hourLocal: number;
      timezone: string;
      migrated: boolean;
    };
    runs: Array<{
      id: string;
      period_start: string;
      status: string;
      metrics_written: number;
      started_at: string;
      error: string | null;
    }>;
  };
  alerts: {
    migrated: boolean;
    slackAuthorized: boolean;
    rules: Array<{
      id: string;
      key: string;
      kind: string;
      name: string;
      enabled: boolean;
      config: Record<string, unknown>;
      recipients: Array<{ type: string; value: string }>;
      channel: string;
      slack_channel: string | null;
      problem: string | null;
      financial: boolean;
    }>;
  };
};

const LIFECYCLES = [
  ["unknown", "Unknown (not mapped)"],
  ["draft", "Draft"],
  ["issued", "Issued"],
  ["partially_paid", "Partially Paid"],
  ["paid", "Paid"],
  ["voided", "Voided"],
] as const;
const STATE_STYLE: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700",
  partially_configured: "bg-amber-50 text-amber-800",
  incomplete_source_data: "bg-amber-50 text-amber-800",
  requires_mapping: "bg-sky-50 text-sky-800",
  sync_disabled: "bg-gray-100 text-gray-700",
  unsupported: "bg-rose-50 text-rose-700",
  requires_migration: "bg-rose-50 text-rose-700",
};
const STATE_LABEL: Record<string, string> = {
  ready: "Ready",
  partially_configured: "Partially configured",
  incomplete_source_data: "Incomplete source data",
  requires_mapping: "Requires mapping",
  sync_disabled: "Sync disabled",
  unsupported: "Unsupported by API",
  requires_migration: "Requires migration",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ALERT_EXAMPLES: Record<string, string> = {
  overdue_invoice: '{ "minDaysPastDue": 30, "minBalance": 0 }',
  forecast_slip: '{ "minDays": 7 }',
  forecast_improvement: '{ "minDays": 7 }',
  high_risk:
    '{ "match": "all", "conditions": [{ "metric": "max_days_past_due", "op": "gte", "value": 60 }] }',
  full_recovery: '{ "watchRuleKey": "your-high-risk-rule-key" }',
};
const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";
const input = "rounded-md border border-[var(--acton-border)] px-2 py-1 text-sm";
const money = (n: number | null) =>
  n === null ? "Incomplete" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function FinancialSettings() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [ppText, setPpText] = useState("");
  const [preview, setPreview] = useState<{
    preview: {
      classified: number;
      matched: number;
      notClassified: number;
      ambiguous: PreviewItem[];
      unmatched: PreviewItem[];
      matchedItems: PreviewItem[];
      pendingApproval: number;
      approved: number;
    };
  } | null>(null);
  const [ruleText, setRuleText] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await aiFetch<Overview>("/api/reports/admin/financial");
      setData(d);
      setStatusMap(
        Object.fromEntries(d.statusInventory.map((r) => [`${r.type}|${r.status}`, r.lifecycle])),
      );
      setPpText(JSON.stringify(d.pp.config, null, 2));
      setRuleText(
        JSON.stringify(
          {
            key: "overdue-30",
            kind: "overdue_invoice",
            name: "Invoices 30+ days overdue",
            enabled: false,
            config: { minDaysPastDue: 30 },
            recipients: [{ type: "role", value: "admin" }],
            channel: "in_app",
            slackChannel: null,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const act = async (key: string, body: unknown, after?: (r: unknown) => void) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const r = await aiFetch<unknown>("/api/reports/admin/financial", {
        method: "POST",
        body: JSON.stringify(body),
      });
      after?.(r);
      if (!after) await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const parseJson = (text: string) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      setError("That isn't valid JSON.");
      return null;
    }
  };

  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading…</p>
    );
  const migrated = data.settings.migrated;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports/settings"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data settings
        </Link>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Financial data</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
              Invoices, payments, tasks, PP# milestones, weekly snapshots, and alerts — all from
              JobTread (read-only). Baxter never fills in missing values.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {!migrated ? (
        <Notice tone="warning">
          Migration 084_financial_reporting.sql hasn&apos;t been applied. Reports still work, but
          statuses show as Unknown and settings can&apos;t be saved until it is.
        </Notice>
      ) : null}

      <section className={card} aria-label="Readiness">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <ClipboardCheck className="h-4 w-4" aria-hidden /> Readiness
        </h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.areas.map((a) => (
            <div key={a.key} className="rounded-md border border-[var(--acton-border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{a.label}</span>
                <Pill className={STATE_STYLE[a.state] ?? ""}>
                  {STATE_LABEL[a.state] ?? a.state}
                </Pill>
              </div>
              <p className="mt-1 text-xs text-[var(--acton-muted)]">{a.detail}</p>
              <p className="mt-1 text-[11px] text-[var(--acton-muted)]">Fix in: {a.setting}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Stat label="Invoiced" value={money(data.totals.invoiced)} />
          <Stat label="Paid" value={money(data.totals.paid)} />
          <Stat label="Outstanding" value={money(data.totals.outstanding)} />
          <Stat label="Overdue" value={money(data.totals.overdue)} />
        </div>
        <p className="mt-2 text-xs text-[var(--acton-muted)]">
          Totals are {data.totals.completeness}. {data.totals.reasons.join(" ")}
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Historical data diagnostics</summary>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">{data.diagnostics.disclaimer}</p>
          <ul className="mt-2 space-y-1">
            {data.diagnostics.diagnostics.map((d) => (
              <li key={d.key}>
                <span className="font-semibold">{d.count}</span> {d.label} —{" "}
                <span className="text-[var(--acton-muted)]">{d.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className={card} aria-label="Status mapping">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <Landmark className="h-4 w-4" aria-hidden /> Status mapping & balances
        </h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Map each JobTread document status to a lifecycle status. Lifecycle is separate from
          payment status, which always comes from JobTread&apos;s amount paid and balance.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--acton-muted)]">
              <th className="py-1">Type</th>
              <th>JobTread status</th>
              <th>Documents</th>
              <th>Lifecycle</th>
            </tr>
          </thead>
          <tbody>
            {data.statusInventory.map((r) => {
              const k = `${r.type}|${r.status}`;
              return (
                <tr key={k} className="border-t border-[var(--acton-border)]">
                  <td className="py-1">{r.type}</td>
                  <td>{r.status || "(blank)"}</td>
                  <td>{r.count}</td>
                  <td>
                    <select
                      aria-label={`Lifecycle for ${r.type} ${r.status}`}
                      className={input}
                      value={statusMap[k] ?? "unknown"}
                      onChange={(e) => setStatusMap({ ...statusMap, [k]: e.target.value })}
                    >
                      {LIFECYCLES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Balance verification
            <select
              className={input}
              value={data.settings.balanceSource}
              onChange={(e) =>
                void act("balance", { action: "save_settings", balanceSource: e.target.value })
              }
            >
              <option value="payments_reconciled">Reconcile with synced payments (strict)</option>
              <option value="jobtread_balance">Accept JobTread&apos;s document balance</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Overdue grace days
            <input
              type="number"
              min={0}
              max={120}
              className={`${input} w-20`}
              defaultValue={data.settings.overdueGraceDays}
              onBlur={(e) =>
                void act("grace", {
                  action: "save_settings",
                  overdueGraceDays: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <Button
            size="sm"
            disabled={busy !== null || !migrated}
            onClick={() =>
              void act("statusmap", {
                action: "save_settings",
                statusMap: Object.entries(statusMap)
                  .filter(([, l]) => l !== "unknown")
                  .map(([k, lifecycle]) => {
                    const [type, ...rest] = k.split("|");
                    return { type, status: rest.join("|"), lifecycle };
                  }),
              })
            }
          >
            Save status mapping
          </Button>
        </div>
        <div className="mt-4 rounded-md bg-[var(--acton-gray-50)] p-3 text-sm">
          <p className="font-semibold">Payments</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {data.paymentsState.enabled
              ? `On — last success ${formatRelative(data.paymentsState.lastSucceededAt)}.`
              : "Off (ships disabled: payments are financial data)."}{" "}
            JobTread reported {data.paymentsState.sourceCount ?? "an unknown number of"} payment
            records at the last catalog check.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void act("backfill-plan", { action: "payments_backfill" }, (r) =>
                  setMessage(JSON.stringify((r as { plan: unknown }).plan)),
                )
              }
            >
              Preview payments backfill
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Turn on payment sync and queue one backfill run?"))
                  void act("backfill", { action: "payments_backfill", confirm: true });
              }}
            >
              Enable payments & backfill
            </Button>
          </div>
        </div>
      </section>

      {data.pm ? (
        <section className={card} aria-label="Project Manager">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
            <UserCheck className="h-4 w-4" aria-hidden /> Project Manager completeness
          </h2>
          <p className="mt-1 text-sm">
            {data.pm.populated} of {data.pm.totalJobs} jobs have a Project Manager
            {data.pm.completenessPct !== null ? ` (${data.pm.completenessPct}%)` : ""}.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {data.pm.defects.map((d, i) => (
              <li key={i}>
                <span className="font-semibold">{d.class.replace("_", " ")}:</span> {d.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            By PM: {data.pm.byPm.map((p) => `${p.pm} (${p.jobs})`).join(", ") || "none"}
            {data.pm.valuesOutsideOptions.length
              ? ` · Values not in the JobTread options: ${data.pm.valuesOutsideOptions.map((v) => `${v.value} (${v.jobs})`).join(", ")}`
              : ""}
          </p>
          {data.pm.blankOpenJobs.length ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">
                Open jobs without a Project Manager ({data.pm.blankOpenJobs.length})
              </summary>
              <ul className="mt-1 columns-2 text-xs">
                {data.pm.blankOpenJobs.map((j) => (
                  <li key={j.id}>
                    {j.name}{" "}
                    {j.phase ? (
                      <span className="text-[var(--acton-muted)]">· {j.phase}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className={card} aria-label="PP# mapping">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <Milestone className="h-4 w-4" aria-hidden /> PP# milestone mapping
        </h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          There&apos;s no confirmed rule yet, so nothing is matched until you configure it.
          Classification: <code>document_field</code> (fieldId), <code>name_pattern</code> or{" "}
          <code>number_pattern</code> (regex; the first capture group is the PP#). Link:{" "}
          <code>task_name_pattern</code> (template with <code>{"{pp}"}</code>),{" "}
          <code>document_field_task_id</code>, or <code>manual_only</code>. Suggested links stay out
          of reports until approved unless <code>autoAcceptUnique</code> is on.
        </p>
        <textarea
          aria-label="PP# configuration"
          className={`${input} mt-2 h-48 w-full font-mono text-xs`}
          value={ppText}
          onChange={(e) => setPpText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => {
              const c = parseJson(ppText);
              if (c)
                void act("pp-preview", { action: "preview_pp", config: c }, (r) =>
                  setPreview(r as never),
                );
            }}
          >
            Preview matches
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !migrated}
            onClick={() => {
              const c = parseJson(ppText);
              if (c) void act("pp-save", { action: "save_pp_config", config: c });
            }}
          >
            Save configuration
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !migrated}
            onClick={() =>
              void act("pp-suggest", { action: "record_pp_suggestions" }, (r) =>
                setMessage(JSON.stringify(r)),
              )
            }
          >
            Record suggested links
          </Button>
        </div>
        {preview ? (
          <div className="mt-3 text-sm">
            <p>
              {preview.preview.classified} PP# invoices · {preview.preview.matched} unique matches ·{" "}
              {preview.preview.ambiguous.length} ambiguous · {preview.preview.unmatched.length}{" "}
              unmatched · {preview.preview.notClassified} invoices not PP# ·{" "}
              {preview.preview.approved} approved · {preview.preview.pendingApproval} awaiting
              approval
            </p>
            {[
              ...preview.preview.ambiguous,
              ...preview.preview.unmatched,
              ...preview.preview.matchedItems,
            ]
              .slice(0, 60)
              .map((i) => (
                <div
                  key={i.documentId}
                  className="mt-1 flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] pt-1 text-xs"
                >
                  <span className="font-semibold">#{i.number ?? i.documentId}</span>
                  <span>PP {i.pp}</span>
                  <Pill className="bg-gray-100">{i.match.status}</Pill>
                  {i.match.reason ? (
                    <span className="text-[var(--acton-muted)]">{i.match.reason}</span>
                  ) : null}
                  {i.link ? <Pill className="bg-sky-50">{i.link.status}</Pill> : null}
                  {i.link?.status === "suggested" ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void act("decide", {
                            action: "decide_pp_link",
                            documentId: i.documentId,
                            decision: "approve",
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void act("decide", {
                            action: "decide_pp_link",
                            documentId: i.documentId,
                            decision: "reject",
                          })
                        }
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {i.match.candidates?.map((c) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void act("decide", {
                          action: "decide_pp_link",
                          documentId: i.documentId,
                          decision: "manual",
                          taskId: c.id,
                          ppNumber: i.pp,
                        })
                      }
                    >
                      Link to “{c.name}”
                    </Button>
                  ))}
                </div>
              ))}
          </div>
        ) : null}
      </section>

      <section className={card} aria-label="Snapshots">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <CalendarClock className="h-4 w-4" aria-hidden /> Weekly snapshots
        </h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Immutable weekly records of invoiced, paid, outstanding, overdue, outstanding by PM,
          forecast completion per job, and late milestones. Collection starts from the next
          scheduled day; past weeks are never filled in.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.snapshots.settings.enabled}
              onChange={(e) =>
                void act("snap", { action: "save_snapshot_settings", enabled: e.target.checked })
              }
              disabled={!data.snapshots.settings.migrated}
            />{" "}
            On
          </label>
          <select
            aria-label="Snapshot weekday"
            className={input}
            value={data.snapshots.settings.weekday}
            onChange={(e) =>
              void act("snap", {
                action: "save_snapshot_settings",
                weekday: Number(e.target.value),
              })
            }
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            at
            <input
              aria-label="Snapshot hour"
              type="number"
              min={0}
              max={23}
              className={`${input} w-16`}
              defaultValue={data.snapshots.settings.hourLocal}
              onBlur={(e) =>
                void act("snap", {
                  action: "save_snapshot_settings",
                  hourLocal: Number(e.target.value),
                })
              }
            />
            :00
          </label>
          <input
            aria-label="Snapshot timezone"
            className={`${input} w-52`}
            defaultValue={data.snapshots.settings.timezone}
            onBlur={(e) =>
              void act("snap", { action: "save_snapshot_settings", timezone: e.target.value })
            }
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !data.snapshots.settings.migrated}
            onClick={() => void act("capture", { action: "capture_snapshot" })}
          >
            Capture this week now
          </Button>
        </div>
        <ul className="mt-2 text-xs">
          {data.snapshots.runs.map((r) => (
            <li key={r.id}>
              Week of {r.period_start}: {r.status} · {r.metrics_written} values ·{" "}
              {formatRelative(r.started_at)} {r.error ? `· ${r.error}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className={card} aria-label="Alerts">
        <h2 className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]">
          <Bell className="h-4 w-4" aria-hidden /> Alerts
        </h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Rules start off. Baxter doesn&apos;t define high risk or full recovery — you do. Financial
          alerts never fire on unverified balances. Slack:{" "}
          {data.alerts.slackAuthorized
            ? "authorized (choose a channel per rule)"
            : "not authorized — alerts are in-app only"}
          .
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {data.alerts.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              <Pill className="bg-gray-100">{r.kind}</Pill>
              <Pill className={r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100"}>
                {r.enabled ? "On" : "Off"}
              </Pill>
              {r.problem ? <span className="text-xs text-amber-800">{r.problem}</span> : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setRuleText(
                    JSON.stringify(
                      {
                        key: r.key,
                        kind: r.kind,
                        name: r.name,
                        enabled: r.enabled,
                        config: r.config,
                        recipients: r.recipients,
                        channel: r.channel,
                        slackChannel: r.slack_channel,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--acton-muted)]">
          Rule JSON. Config examples:{" "}
          {Object.entries(ALERT_EXAMPLES)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
          . Recipients: {'{ "type": "role", "value": "admin" }'} or{" "}
          {'{ "type": "user", "value": "<user id>" }'}.
        </p>
        <textarea
          aria-label="Alert rule"
          className={`${input} mt-1 h-44 w-full font-mono text-xs`}
          value={ruleText}
          onChange={(e) => setRuleText(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={busy !== null || !data.alerts.migrated}
            onClick={() => {
              const r = parseJson(ruleText);
              if (r) void act("rule", { action: "save_alert_rule", rule: r });
            }}
          >
            Save rule
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !data.alerts.migrated}
            onClick={() =>
              void act("evaluate", { action: "evaluate_alerts" }, (r) =>
                setMessage(JSON.stringify(r)),
              )
            }
          >
            Evaluate now
          </Button>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--acton-gray-50)] p-2">
      <p className="text-xs text-[var(--acton-muted)]">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
