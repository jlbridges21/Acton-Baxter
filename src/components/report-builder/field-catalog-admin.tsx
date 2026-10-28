"use client";

/**
 * /reports/settings/fields (admins): the JobTread-native field catalog and its audit.
 *   - refresh status (including removals held because a response looked incomplete)
 *   - fields by entity (active / excluded / stale / unsupported), searchable by current label,
 *     old label, business name, or stable id
 *   - business-name aliases with problems (conflict, ambiguous, shared text, stale) and
 *     dry-run repairs
 *   - reports, saved views, and metrics with field problems, with a repair preview that
 *     saves a new report version only when applied
 * Changing what people may see stays on Data settings → Field access; nothing here widens it.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Database, RefreshCw, Search } from "lucide-react";
import { aiFetch, errorMessage, formatRelative, Notice, Pill, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Field = {
  ref: string;
  id: string | null;
  entity: string;
  label: string;
  jobtreadName: string | null;
  type: string;
  category: string;
  status: "active" | "stale" | "excluded" | "unsupported";
  statusReason: string | null;
  kind: "custom" | "standard";
  aliases: string[];
  renamedFrom: string[];
  duplicateLabel: boolean;
  typeChange: { from: string; at: string } | null;
};
type Brief = { id: string; name: string; type: string; target: string };
type Alias = {
  key: string;
  ref: string;
  label: string;
  status: string;
  reason: string | null;
  target: (Brief & { removed: boolean }) | null;
  repair: Brief | null;
  candidates: Brief[];
  sharedWith: string[];
};
type Catalog = {
  total: number;
  offset: number;
  fields: Field[];
  counts: Record<string, Record<string, number>>;
  aliases: Alias[];
  refresh: {
    status: string;
    started_at: string;
    finished_at: string | null;
    seen: number;
    added: number;
    renamed: number;
    removed: number;
    held_removals: number;
    error: string | null;
  } | null;
};
type Finding = {
  where: string;
  reportId: string | null;
  title: string;
  path: string;
  ref: string;
  kind: string;
  severity: "error" | "warning";
  message: string;
  suggestion: { to: string; label: string } | null;
};
type Audit = {
  reportsChecked: number;
  viewsChecked: number;
  summary: Record<string, number>;
  total: number;
  findings: Finding[];
};
type RepairPreview = {
  reportId: string;
  title: string;
  version: number;
  changes: Array<{ path: string; from: string; to: string }>;
  removedDuplicates: string[];
  valid: boolean;
  issues: string[];
  problemsBefore: number;
  problemsAfter: number;
  saved?: boolean;
};

const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";
const ENTITY_LABELS: Record<string, string> = {
  job: "Jobs",
  location: "Locations",
  customer: "Customers",
  customerContact: "Customer contacts",
  vendor: "Vendors",
  vendorContact: "Vendor contacts",
  dailyLog: "Daily logs",
  costItem: "Cost items",
};
const TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-800",
  ok: "bg-emerald-50 text-emerald-800",
  stale: "bg-red-50 text-red-800",
  conflict: "bg-red-50 text-red-800",
  ambiguous: "bg-amber-50 text-amber-900",
  shared_text: "bg-amber-50 text-amber-900",
  deprecated: "bg-slate-100 text-slate-700",
  excluded: "bg-slate-100 text-slate-700",
  unsupported: "bg-slate-100 text-slate-700",
  unmapped: "bg-slate-100 text-slate-700",
};
const label = (s: string) => s.replace(/_/g, " ");

export function FieldCatalogAdmin() {
  const [data, setData] = useState<Catalog | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [query, setQuery] = useState({ search: "", entity: "", status: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback(
    async (q = query) => {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
      setData(await aiFetch<Catalog>(`/api/reports/admin/field-catalog?${p}`));
    },
    [query],
  );
  useLoad(
    useCallback(async () => {
      try {
        await load();
        setAudit(await aiFetch<Audit>("/api/reports/admin/field-audit"));
      } catch (e) {
        setError(errorMessage(e));
      }
    }, [load]),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = (confirmRemovals = false) =>
    run(async () => {
      await aiFetch("/api/reports/admin/field-catalog", {
        method: "POST",
        body: JSON.stringify({ action: "refresh", confirmRemovals }),
      });
      await load();
      setAudit(await aiFetch<Audit>("/api/reports/admin/field-audit"));
      setNotice(confirmRemovals ? "Removals confirmed." : "Catalog refreshed from JobTread.");
    });
  const aliasRepair = (key: string, repair: Record<string, unknown>) =>
    run(async () => {
      await aiFetch("/api/reports/admin/field-audit", {
        method: "POST",
        body: JSON.stringify({ op: "alias_apply", key, repair }),
      });
      await load();
      setAudit(await aiFetch<Audit>("/api/reports/admin/field-audit"));
      setNotice(`sem:${key} updated.`);
    });
  const reportRepair = (reportId: string, apply: boolean) =>
    run(async () => {
      const res = await aiFetch<RepairPreview>("/api/reports/admin/field-audit", {
        method: "POST",
        body: JSON.stringify({
          op: apply ? "report_apply" : "report_preview",
          reportId,
          ...(apply && preview ? { expectedVersion: preview.version } : {}),
        }),
      });
      setPreview(apply ? null : res);
      if (apply) {
        setNotice(
          res.saved
            ? `Saved version ${(res as unknown as { version: number }).version} of “${res.title}”. Restore the previous version from its history to undo.`
            : "Nothing to change.",
        );
        setAudit(await aiFetch<Audit>("/api/reports/admin/field-audit"));
      }
    });

  const problemAliases = (data?.aliases ?? []).filter(
    (a) => !["ok", "unmapped"].includes(a.status),
  );
  const byReport = new Map<string, Finding[]>();
  for (const f of audit?.findings ?? []) {
    const k = `${f.reportId ?? ""}|${f.title}`;
    byReport.set(k, [...(byReport.get(k) ?? []), f]);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports/settings"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data settings
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--acton-navy)]">
          <Database className="h-5 w-5" aria-hidden /> Field catalog
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
          Every JobTread field Baxter has discovered, identified by its permanent JobTread id and
          shown with its current JobTread name. New and renamed fields appear after each refresh —
          no setup needed. Who may see a field is set separately under Field access.
        </p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[var(--acton-navy)]">Last refresh</h2>
            {data?.refresh ? (
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                <Pill
                  className={
                    TONE[
                      data.refresh.status === "succeeded"
                        ? "active"
                        : data.refresh.status === "held"
                          ? "ambiguous"
                          : "stale"
                    ] ?? ""
                  }
                >
                  {data.refresh.status}
                </Pill>{" "}
                {formatRelative(data.refresh.finished_at ?? data.refresh.started_at)} ·{" "}
                {data.refresh.seen} fields seen · {data.refresh.added} added ·{" "}
                {data.refresh.renamed} renamed · {data.refresh.removed} removed
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                Refresh history appears after migration 080 is applied; fields still refresh with
                every JobTread sync.
              </p>
            )}
            {data?.refresh?.error ? (
              <Notice tone={data.refresh.status === "held" ? "warning" : "error"} className="mt-2">
                {data.refresh.error}
              </Notice>
            ) : null}
          </div>
          <div className="flex gap-2">
            {data?.refresh?.held_removals ? (
              <Button variant="secondary" onClick={() => void refresh(true)} disabled={busy}>
                Confirm {data.refresh.held_removals} removals
              </Button>
            ) : null}
            <Button onClick={() => void refresh(false)} disabled={busy}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Refresh now
            </Button>
          </div>
        </div>
        {data ? (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-[var(--acton-muted)]">
              <tr>
                <th className="py-1">JobTread entity</th>
                <th className="py-1 text-right">Discovered</th>
                <th className="py-1 text-right">In reports</th>
                <th className="py-1 text-right">Excluded</th>
                <th className="py-1 text-right">Not reportable</th>
                <th className="py-1 text-right">Removed (stale)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.counts).map(([entity, c]) => (
                <tr key={entity} className="border-t border-[var(--acton-gray-100)]">
                  <td className="py-1.5">{ENTITY_LABELS[entity] ?? entity}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.total}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.active}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.excluded}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.unsupported}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.stale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="mt-2 text-xs text-[var(--acton-muted)]">
          Contacts, vendors, daily logs, and cost-item custom fields are discovered but stay out of
          reports (no report source for their values; excluded by default).
        </p>
      </section>

      {problemAliases.length ? (
        <section className={card}>
          <h2 className="font-semibold text-[var(--acton-navy)]">
            Business names needing attention
          </h2>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Business names (sem:…) are optional shortcuts to JobTread fields. These point at the
            wrong field, at a field that no longer exists, or at a shared narrative text field.
            Repairs change the shortcut only; reports keep their history.
          </p>
          <ul className="mt-3 divide-y divide-[var(--acton-border)]">
            {problemAliases.map((a) => (
              <li key={a.key} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <code>{a.ref}</code>
                  <span className="font-semibold text-[var(--acton-navy)]">{a.label}</span>
                  <Pill className={TONE[a.status] ?? ""}>{label(a.status)}</Pill>
                </div>
                <p className="mt-1 text-[var(--acton-muted)]">{a.reason}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {a.repair ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void aliasRepair(a.key, { action: "apply_suggested" })}
                    >
                      Point at “{a.repair.name}” (cf:{a.repair.id})
                    </Button>
                  ) : null}
                  {a.candidates.length ? (
                    <>
                      <select
                        aria-label={`Field for ${a.label}`}
                        className="h-8 rounded-md border border-[var(--acton-border)] px-2 text-xs"
                        value={choice[a.key] ?? ""}
                        onChange={(e) => setChoice({ ...choice, [a.key]: e.target.value })}
                      >
                        <option value="">Choose the intended field…</option>
                        {a.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !choice[a.key]}
                        onClick={() =>
                          void aliasRepair(a.key, { action: "remap", fieldId: choice[a.key] })
                        }
                      >
                        Use this field
                      </Button>
                    </>
                  ) : null}
                  {a.status === "shared_text" ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void aliasRepair(a.key, {
                            action: "deprecate",
                            note: "Reads a shared narrative field; use the native field.",
                          })
                        }
                      >
                        Mark deprecated
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void aliasRepair(a.key, {
                            action: "verify",
                            note: "Intentional business name for this text field.",
                          })
                        }
                      >
                        This is intentional
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={card}>
        <h2 className="font-semibold text-[var(--acton-navy)]">Reports using problem fields</h2>
        {audit ? (
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Checked {audit.reportsChecked} reports and {audit.viewsChecked} saved views (columns,
            filters, sorting, grouping, calculations, colors, and viewer controls).{" "}
            {audit.total ? `${audit.total} finding(s).` : "No problems found."}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--acton-muted)]">Checking…</p>
        )}
        <ul className="mt-3 space-y-3">
          {[...byReport.entries()].map(([k, list]) => {
            const reportId = list[0]!.reportId;
            const repairable = list.some((f) => f.suggestion) && list[0]!.where === "report";
            return (
              <li key={k} className="rounded-md border border-[var(--acton-border)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {reportId && list[0]!.where === "report" ? (
                    <Link
                      href={`/reports/${reportId}`}
                      className="font-semibold text-[var(--acton-navy)] underline"
                    >
                      {list[0]!.title}
                    </Link>
                  ) : (
                    <span className="font-semibold text-[var(--acton-navy)]">{list[0]!.title}</span>
                  )}
                  {repairable && reportId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void reportRepair(reportId, false)}
                    >
                      Preview safe repair
                    </Button>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {list.slice(0, 12).map((f, i) => (
                    <li
                      key={i}
                      className={cn(f.severity === "error" ? "text-red-800" : "text-amber-900")}
                    >
                      <code>{f.ref}</code> at <code>{f.path}</code> — {label(f.kind)}: {f.message}
                      {f.suggestion ? ` → can use ${f.suggestion.to} (${f.suggestion.label})` : ""}
                    </li>
                  ))}
                  {list.length > 12 ? <li>…and {list.length - 12} more</li> : null}
                </ul>
                {preview && preview.reportId === reportId ? (
                  <div className="mt-3 rounded-md bg-[var(--acton-gray-50)] p-3 text-xs">
                    <p className="font-semibold text-[var(--acton-navy)]">
                      Dry run: {preview.changes.length} reference(s) change; problems{" "}
                      {preview.problemsBefore} → {preview.problemsAfter}.
                      {preview.valid ? "" : " The result doesn't validate:"}
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {preview.changes.slice(0, 20).map((c, i) => (
                        <li key={i}>
                          <code>{c.path}</code>: {c.from} → {c.to}
                        </li>
                      ))}
                      {preview.removedDuplicates.map((d) => (
                        <li key={d}>Removed {d} (same field twice)</li>
                      ))}
                      {preview.issues.map((d) => (
                        <li key={d} className="text-red-800">
                          {d}
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={busy || !preview.valid || !preview.changes.length}
                      onClick={() => void reportRepair(reportId!, true)}
                    >
                      Save as version {preview.version + 1}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-[var(--acton-navy)]">All fields</h2>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => load(query));
          }}
        >
          <label className="relative block w-72">
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--acton-muted)]"
              aria-hidden
            />
            <input
              value={query.search}
              onChange={(e) => setQuery({ ...query, search: e.target.value })}
              placeholder="Name, old name, sem: key, or id"
              aria-label="Search fields"
              className="h-9 w-full rounded-md border border-[var(--acton-border)] pr-3 pl-8 text-sm"
            />
          </label>
          <select
            aria-label="Entity"
            className="h-9 rounded-md border border-[var(--acton-border)] px-2 text-sm"
            value={query.entity}
            onChange={(e) => setQuery({ ...query, entity: e.target.value })}
          >
            <option value="">All entities</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            className="h-9 rounded-md border border-[var(--acton-border)] px-2 text-sm"
            value={query.status}
            onChange={(e) => setQuery({ ...query, status: e.target.value })}
          >
            <option value="">Any status</option>
            {["active", "excluded", "unsupported", "stale"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" disabled={busy}>
            Search
          </Button>
        </form>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--acton-muted)]">
              <tr>
                <th className="py-1">Field</th>
                <th className="py-1">Reference</th>
                <th className="py-1">Entity</th>
                <th className="py-1">Type</th>
                <th className="py-1">Status</th>
                <th className="py-1">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(data?.fields ?? []).map((f) => (
                <tr key={f.ref} className="border-t border-[var(--acton-gray-100)] align-top">
                  <td className="py-1.5 font-semibold text-[var(--acton-navy)]">{f.label}</td>
                  <td className="py-1.5">
                    <code className="text-xs">{f.ref}</code>
                  </td>
                  <td className="py-1.5">{ENTITY_LABELS[f.entity] ?? f.entity}</td>
                  <td className="py-1.5">{f.type}</td>
                  <td className="py-1.5">
                    <Pill className={TONE[f.status] ?? ""}>{f.status}</Pill>
                  </td>
                  <td className="py-1.5 text-xs text-[var(--acton-muted)]">
                    {[
                      f.statusReason,
                      f.renamedFrom.length ? `Was “${f.renamedFrom.join("”, “")}”` : null,
                      f.duplicateLabel ? "Another field has the same name" : null,
                      f.typeChange
                        ? `Type changed from ${f.typeChange.from} on ${f.typeChange.at.slice(0, 10)}`
                        : null,
                      f.aliases.length ? `Business names: ${f.aliases.join(", ")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.total > data.fields.length ? (
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              Showing {data.fields.length} of {data.total}. Narrow the search to see more.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
