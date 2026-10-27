"use client";

/**
 * /reports/metrics — the Metric Library and Calculated Field Builder. Anyone with Reports
 * access can create private metrics; Reports managers publish company metrics. Formulas are
 * validated and previewed on real data by the server; nothing here calculates numbers.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, Copy, FlaskConical, Plus, RotateCcw, Sigma } from "lucide-react";
import {
  aiFetch,
  errorMessage,
  formatRelative,
  Notice,
  Pill,
  selectClass,
  textareaClass,
  useLoad,
} from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGGREGATE_FUNCTIONS, SCALAR_FUNCTIONS } from "@/lib/reports/formula";
import { ROLLUPS } from "@/lib/reports/relationships";
import {
  CALC_TYPES,
  ROLLUP_OPS,
  SOURCES,
  type CalculationSpec,
  type ReportSource,
} from "@/lib/reports/spec";

type Metric = {
  key: string;
  ref: string;
  definition: CalculationSpec;
  visibility: "company" | "private";
  version: number;
  archived: boolean;
  updatedAt: string;
  mine: boolean;
  canEdit: boolean;
  usable: boolean;
  accessRequired: string | null;
  problem: string | null;
};
type Field = { key: string; label: string; type: string; calc?: string; via?: string };
type FieldsResponse = Record<ReportSource, { business: Field[]; all: Field[] }>;
type Preview = Record<string, unknown> & { ok: boolean; problem?: string };
type Detail = {
  versions: Array<{
    version: number;
    summary: string | null;
    authorKind: string;
    createdAt: string;
  }>;
  usage: { reports: Array<{ id: string; title: string }>; metrics: string[] };
};

const SOURCE_LABELS: Record<ReportSource, string> = {
  jobs: "Jobs",
  catalog_models: "Product Library models",
  cost_items: "Cost items",
  commissions: "Commissions",
};
const BASIS_HELP = {
  row: "One value per record (e.g. Price − Cost for each job). Can be filtered, grouped, sorted, and summed or averaged.",
  aggregate:
    "Computed for each group from its totals (e.g. (SUM(price) − SUM(cost)) ÷ SUM(price) × 100 — a weighted margin). Use in KPIs, charts, and table subtotals.",
  rollup:
    "One value per record from its related records (e.g. a job's total budget cost from its cost items). Pre-aggregated by id, so totals never double count.",
} as const;
const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";
const inputClass =
  "block h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)]";

const blank = (): CalculationSpec => ({
  key: "",
  label: "",
  source: "jobs",
  basis: "row",
  formula: "",
  type: "number",
});
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "m_$1")
    .slice(0, 40);

export function MetricLibrary() {
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [fields, setFields] = useState<FieldsResponse | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<CalculationSpec>(blank);
  const [editing, setEditing] = useState<Metric | null>(null);
  const [visibility, setVisibility] = useState<"private" | "company">("private");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewGroup, setPreviewGroup] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formulaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const [m, f] = await Promise.all([
        aiFetch<{ metrics: Metric[]; canPublishCompany: boolean }>(
          `/api/reports/metrics${showArchived ? "?archived=1" : ""}`,
        ),
        aiFetch<FieldsResponse>("/api/reports/fields"),
      ]);
      setMetrics(m.metrics);
      setCanPublish(m.canPublishCompany);
      setFields(f);
      return m.metrics;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, [showArchived]);
  useLoad(
    useCallback(async () => {
      await load();
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

  const select = (m: Metric | null, copy = false) => {
    setPreview(null);
    setDetail(null);
    if (!m) {
      setEditing(null);
      setDraft(blank());
      setVisibility("private");
      return;
    }
    const def = structuredClone(m.definition);
    if (copy) {
      def.key = slug(`${def.key}_copy`);
      def.label = `${def.label} (copy)`;
    }
    setEditing(copy ? null : m);
    setDraft(def);
    setVisibility(copy ? "private" : m.visibility);
    if (!copy)
      void aiFetch<Detail>(`/api/reports/metrics/${m.key}`)
        .then(setDetail)
        .catch(() => null);
  };

  const sourceFields = useMemo(() => {
    if (!fields) return [] as Field[];
    const f = fields[draft.source];
    return [
      ...f.business,
      ...f.all.filter((x) => !x.key.startsWith("calc:") || x.key !== `calc:${draft.key}`),
    ];
  }, [fields, draft.source, draft.key]);
  const rollups = Object.values(ROLLUPS).filter((r) => r.parent === draft.source);
  const childFields = useMemo(() => {
    const rel = draft.rollup ? ROLLUPS[draft.rollup.relationship as keyof typeof ROLLUPS] : null;
    return rel && fields ? fields[rel.child].all.filter((f) => f.calc !== "aggregate") : [];
  }, [fields, draft.rollup]);

  const insert = (text: string) => {
    const el = formulaRef.current;
    const current = draft.formula ?? "";
    const at = el ? el.selectionStart : current.length;
    const end = el ? el.selectionEnd : current.length;
    const next = `${current.slice(0, at)}${text}${current.slice(end)}`;
    setDraft({ ...draft, formula: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  const definition = (): CalculationSpec => {
    const d = { ...draft, key: draft.key || slug(draft.label) };
    if (d.basis === "rollup") delete d.formula;
    else delete d.rollup;
    return d;
  };

  const doPreview = () =>
    run(async () => {
      setPreview(
        await aiFetch<Preview>("/api/reports/metrics/preview", {
          method: "POST",
          body: JSON.stringify({ calculation: definition(), groupBy: previewGroup || undefined }),
        }),
      );
    });

  const save = () =>
    run(async () => {
      const def = definition();
      const res = await aiFetch<{ key: string; version: number }>("/api/reports/metrics", {
        method: "POST",
        body: JSON.stringify({
          definition: def,
          visibility,
          expectedVersion: editing?.version,
        }),
      });
      setNotice(`Saved calc:${res.key} (version ${res.version}). Use it in any report.`);
      const saved = (await load())?.find((m) => m.key === res.key);
      if (saved) select(saved);
      else setDraft(def);
    });

  const archive = (m: Metric, archived: boolean) =>
    run(async () => {
      await aiFetch(`/api/reports/metrics/${m.key}`, {
        method: "PATCH",
        body: JSON.stringify({ archived }),
      });
      setNotice(archived ? `Archived calc:${m.key}.` : `Restored calc:${m.key}.`);
      await load();
    });

  const q = search.trim().toLowerCase();
  const list = (metrics ?? []).filter(
    (m) =>
      !q ||
      m.key.includes(q) ||
      m.definition.label.toLowerCase().includes(q) ||
      (m.definition.formula ?? "").toLowerCase().includes(q),
  );
  const readOnly = editing ? !editing.canEdit : false;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Reports
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--acton-navy)]">
          <Sigma className="h-5 w-5" aria-hidden /> Metric Library
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
          Calculated fields you can reuse in any report — as KPI values, chart metrics, table
          columns, filters, or sorting. Dexter can create and use them too. Company metrics are
          shared definitions maintained by Reports managers; private metrics are yours.
        </p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className={card}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-[var(--acton-navy)]">Metrics</h2>
            <Button size="sm" onClick={() => select(null)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> New
            </Button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search metrics"
            aria-label="Search metrics"
            className={cn(inputClass, "mt-3")}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--acton-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          {!metrics ? <p className="mt-3 text-sm text-[var(--acton-muted)]">Loading…</p> : null}
          {metrics && !list.length ? (
            <p className="mt-3 text-sm text-[var(--acton-muted)]">
              No metrics yet. Create one here, or ask Dexter (“create a Cost per SQFT metric”).
            </p>
          ) : null}
          <ul className="mt-3 space-y-1">
            {list.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  onClick={() => select(m)}
                  className={cn(
                    "w-full rounded-md px-2 py-2 text-left hover:bg-[var(--acton-gray-50)]",
                    editing?.key === m.key && "bg-[var(--acton-gray-50)]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-[var(--acton-navy)]">
                      {m.definition.label}
                    </span>
                    <Pill
                      className={
                        m.visibility === "company"
                          ? "bg-blue-50 text-blue-800"
                          : "bg-slate-100 text-slate-700"
                      }
                    >
                      {m.visibility === "company" ? "Company" : "Private"}
                    </Pill>
                    {m.archived ? (
                      <Pill className="bg-amber-50 text-amber-900">Archived</Pill>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-[var(--acton-muted)]">
                    <code>{m.ref}</code> · {SOURCE_LABELS[m.definition.source]} ·{" "}
                    {m.definition.basis}
                  </span>
                  {m.problem ? (
                    <span className="block text-xs text-red-700">{m.problem}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={cn(card, "space-y-4")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-[var(--acton-navy)]">
              {editing ? `Edit ${editing.definition.label}` : "New calculated field"}
            </h2>
            {editing ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => select(editing, true)}>
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
                </Button>
                {editing.canEdit ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => archive(editing, !editing.archived)}
                    disabled={busy}
                  >
                    {editing.archived ? (
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Archive className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {editing.archived ? "Restore" : "Archive"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {readOnly ? (
            <Notice tone="info">
              This is a company metric maintained by Reports managers. Duplicate it to make your own
              version.
            </Notice>
          ) : null}
          <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="font-semibold text-[var(--acton-navy)]">Name</span>
              <input
                className={cn(inputClass, "mt-1")}
                value={draft.label}
                maxLength={80}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    label: e.target.value,
                    ...(editing ? {} : { key: slug(e.target.value) }),
                  })
                }
                placeholder="Cost per SQFT"
              />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-[var(--acton-navy)]">Reference</span>
              <input
                className={cn(inputClass, "mt-1 font-mono")}
                value={draft.key}
                disabled={Boolean(editing)}
                onChange={(e) => setDraft({ ...draft, key: slug(e.target.value) })}
                placeholder="cost_per_sqft"
              />
              <span className="mt-1 block text-xs text-[var(--acton-muted)]">
                Used in reports as <code>calc:{draft.key || "…"}</code>
              </span>
            </label>
            <label className="text-sm md:col-span-2">
              <span className="font-semibold text-[var(--acton-navy)]">Description</span>
              <input
                className={cn(inputClass, "mt-1")}
                value={draft.description ?? ""}
                maxLength={400}
                onChange={(e) => setDraft({ ...draft, description: e.target.value || undefined })}
                placeholder="What it means and which fields it uses"
              />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-[var(--acton-navy)]">Records</span>
              <select
                className={cn(selectClass, "mt-1 h-10")}
                value={draft.source}
                onChange={(e) =>
                  setDraft({ ...draft, source: e.target.value as ReportSource, rollup: undefined })
                }
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-semibold text-[var(--acton-navy)]">Calculated</span>
              <select
                className={cn(selectClass, "mt-1 h-10")}
                value={draft.basis}
                onChange={(e) => {
                  const basis = e.target.value as CalculationSpec["basis"];
                  setDraft({
                    ...draft,
                    basis,
                    ...(basis === "rollup" && !draft.rollup && rollups[0]
                      ? { rollup: { relationship: rollups[0].id, op: "sum", filters: [] } }
                      : {}),
                  });
                }}
              >
                <option value="row">Per record (row formula)</option>
                <option value="aggregate">Per group (aggregate formula)</option>
                <option value="rollup" disabled={!rollups.length}>
                  From related records (rollup)
                </option>
              </select>
            </label>
            <p className="text-xs text-[var(--acton-muted)] md:col-span-2">
              {BASIS_HELP[draft.basis]}
            </p>

            {draft.basis === "rollup" ? (
              <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
                <label className="text-sm">
                  <span className="font-semibold text-[var(--acton-navy)]">Related records</span>
                  <select
                    className={cn(selectClass, "mt-1 h-10")}
                    value={draft.rollup?.relationship ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        rollup: { relationship: e.target.value, op: "sum", filters: [] },
                      })
                    }
                  >
                    {rollups.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-[var(--acton-navy)]">Aggregate</span>
                  <select
                    className={cn(selectClass, "mt-1 h-10")}
                    value={draft.rollup?.op ?? "sum"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        rollup: {
                          ...(draft.rollup ?? { relationship: rollups[0]?.id ?? "", filters: [] }),
                          op: e.target.value as (typeof ROLLUP_OPS)[number],
                        },
                      })
                    }
                  >
                    {ROLLUP_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-[var(--acton-navy)]">Of field</span>
                  <select
                    className={cn(selectClass, "mt-1 h-10")}
                    value={draft.rollup?.field ?? ""}
                    disabled={draft.rollup?.op === "count"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        rollup: {
                          ...(draft.rollup ?? {
                            relationship: rollups[0]?.id ?? "",
                            op: "sum",
                            filters: [],
                          }),
                          field: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">(records)</option>
                    {childFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm">
                  <span className="font-semibold text-[var(--acton-navy)]">Formula</span>
                  <textarea
                    ref={formulaRef}
                    className={cn(textareaClass, "mt-1 font-mono")}
                    rows={3}
                    value={draft.formula ?? ""}
                    maxLength={1000}
                    onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
                    placeholder={
                      draft.basis === "aggregate"
                        ? "(SUM(job.orderPrice) - SUM(job.orderCost)) / SUM(job.orderPrice) * 100"
                        : "DIVIDE(job.projectedCost, sem:total_sqft)"
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Insert a field"
                    className={cn(selectClass, "h-9 w-64")}
                    value=""
                    onChange={(e) => e.target.value && insert(e.target.value)}
                  >
                    <option value="">Insert field…</option>
                    {sourceFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.calc ? " (calculated)" : f.via ? " (related)" : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Insert a function"
                    className={cn(selectClass, "h-9 w-56")}
                    value=""
                    onChange={(e) => e.target.value && insert(`${e.target.value}(`)}
                  >
                    <option value="">Insert function…</option>
                    {Object.entries(SCALAR_FUNCTIONS).map(([k, f]) => (
                      <option key={k} value={k} title={f.help}>
                        {k}
                      </option>
                    ))}
                    {draft.basis === "aggregate"
                      ? Object.entries(AGGREGATE_FUNCTIONS)
                          .filter(([k]) => !SCALAR_FUNCTIONS[k])
                          .map(([k, f]) => (
                            <option key={k} value={k} title={f.help}>
                              {k} (aggregate)
                            </option>
                          ))
                      : null}
                  </select>
                </div>
                <p className="text-xs text-[var(--acton-muted)]">
                  + − × ÷ ( ), comparisons, AND / OR / NOT. A blank value stays blank (use
                  COALESCE(x, 0) to count it as zero); dividing by zero gives a blank, never a wrong
                  number.
                </p>
              </div>
            )}

            <label className="text-sm">
              <span className="font-semibold text-[var(--acton-navy)]">Result type</span>
              <select
                className={cn(selectClass, "mt-1 h-10")}
                value={draft.type}
                onChange={(e) =>
                  setDraft({ ...draft, type: e.target.value as CalculationSpec["type"] })
                }
              >
                {CALC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "sqft" ? "square feet" : t}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="font-semibold text-[var(--acton-navy)]">Unit</span>
                <input
                  className={cn(inputClass, "mt-1")}
                  value={draft.unit ?? ""}
                  maxLength={20}
                  placeholder="$/sqft"
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value || undefined })}
                />
              </label>
              <label className="text-sm">
                <span className="font-semibold text-[var(--acton-navy)]">Decimals</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  className={cn(inputClass, "mt-1")}
                  value={draft.decimals ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      decimals: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="text-sm md:col-span-2">
              <span className="font-semibold text-[var(--acton-navy)]">Who can use it</span>
              <select
                className={cn(selectClass, "mt-1 h-10")}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "private" | "company")}
              >
                <option value="private">
                  Private — my metric (anyone can use it in a report I share)
                </option>
                <option value="company" disabled={!canPublish}>
                  Company metric — shared definition{canPublish ? "" : " (Reports managers only)"}
                </option>
              </select>
            </label>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] pt-4">
            {draft.basis === "aggregate" ? (
              <select
                aria-label="Preview grouped by"
                className={cn(selectClass, "h-9 w-56")}
                value={previewGroup}
                onChange={(e) => setPreviewGroup(e.target.value)}
              >
                <option value="">Preview overall</option>
                {sourceFields
                  .filter(
                    (f) => !f.calc && !["currency", "number", "percent", "sqft"].includes(f.type),
                  )
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      By {f.label}
                    </option>
                  ))}
              </select>
            ) : null}
            <Button variant="secondary" onClick={doPreview} disabled={busy || !draft.label}>
              <FlaskConical className="h-4 w-4" aria-hidden /> Preview on real data
            </Button>
            {!readOnly ? (
              <Button onClick={save} disabled={busy || !draft.label}>
                {editing ? "Save new version" : "Save metric"}
              </Button>
            ) : null}
          </div>

          {preview ? <PreviewPanel preview={preview} /> : null}

          {detail ? (
            <div className="grid gap-4 border-t border-[var(--acton-border)] pt-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Used by</h3>
                {detail.usage.reports.length || detail.usage.metrics.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {detail.usage.reports.map((r) => (
                      <li key={r.id}>
                        <Link
                          className="text-[var(--acton-navy)] underline"
                          href={`/reports/${r.id}`}
                        >
                          {r.title}
                        </Link>
                      </li>
                    ))}
                    {detail.usage.metrics.map((k) => (
                      <li key={k}>
                        Metric <code>calc:{k}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-[var(--acton-muted)]">Not used yet.</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--acton-navy)]">History</h3>
                <ul className="mt-1 space-y-1 text-xs text-[var(--acton-muted)]">
                  {detail.versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} · {v.summary ?? "Saved"} ·{" "}
                      {v.authorKind === "dexter" ? "Dexter" : v.authorKind} ·{" "}
                      {formatRelative(v.createdAt)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: Preview }) {
  if (!preview.ok) return <Notice tone="error">{preview.problem}</Notice>;
  const fmt = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "—"
      : typeof v === "number"
        ? v.toLocaleString()
        : String(v);
  const samples = (preview.samples as Array<Record<string, unknown>> | undefined) ?? [];
  const byGroup = (preview.byGroup as Array<Record<string, unknown>> | undefined) ?? [];
  const coverage =
    (preview.inputCoverage as
      Array<{ field: string; label: string; filled: number }> | undefined) ?? [];
  return (
    <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4 text-sm">
      <p className="font-semibold text-emerald-900">
        Valid · {Number(preview.records).toLocaleString()} records
        {preview.accessRequired && preview.accessRequired !== "general"
          ? ` · viewers need ${String(preview.accessRequired)} access`
          : ""}
      </p>
      {"overall" in preview ? (
        <p>
          Overall value: <strong>{fmt(preview.overall)}</strong>
        </p>
      ) : (
        <p>
          Calculated for {fmt(preview.computed)} records; blank for {fmt(preview.blank)}
          {Number(preview.blank)
            ? ` (${fmt(preview.blankBecauseInputsMissing)} because an input is blank)`
            : ""}
          .
        </p>
      )}
      {coverage.length ? (
        <p className="text-xs text-[var(--acton-muted)]">
          Inputs:{" "}
          {coverage.map((c) => `${c.label} filled on ${c.filled.toLocaleString()}`).join(" · ")}
        </p>
      ) : null}
      {byGroup.length ? (
        <table className="w-full text-xs">
          <tbody>
            {byGroup.map((g) => (
              <tr key={String(g.group)} className="border-t border-emerald-100">
                <td className="py-1">{String(g.group)}</td>
                <td className="py-1 text-right">{fmt(g.records)} records</td>
                <td className="py-1 text-right font-semibold">{fmt(g.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {samples.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--acton-muted)]">
              <tr>
                {Object.keys(samples[0]!).map((k) => (
                  <th key={k} className="py-1 pr-3 font-semibold">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={i} className="border-t border-emerald-100">
                  {Object.values(s).map((v, j) => (
                    <td key={j} className="py-1 pr-3">
                      {fmt(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {preview.note ? (
        <p className="text-xs text-[var(--acton-muted)]">{String(preview.note)}</p>
      ) : null}
    </div>
  );
}
