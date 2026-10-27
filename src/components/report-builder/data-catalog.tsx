"use client";

/**
 * /reports/catalog — the verified JobTread Data Catalog: what JobTread exposes through
 * Acton's grant, which fields are populated, what this viewer may use, and why each kind of
 * report is (or isn't) possible.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CatalogField = {
  name: string;
  label: string;
  type: string;
  description: string;
  accessible: boolean;
  populated: number | null;
  filterable: boolean;
  relation?: string;
};
type Entity = {
  entity: string;
  label: string;
  description: string;
  record_count: number | null;
  accessible: boolean;
  reportable: boolean;
  fields: CatalogField[];
  relationships: string[];
  error: string | null;
  last_verified_at: string;
};
type ReportField = {
  key: string;
  label: string;
  type: string;
  source: string;
  target: string | null;
  category: string;
  custom: boolean;
  options: string[];
  origin: string;
  description: string | null;
  filled: number | null;
};
type Capability = {
  key: string;
  label: string;
  source: string;
  status: string;
  statusText: string;
  available: string;
  gap: string;
  alternative: string | null;
};
type Suggestion = {
  key: string;
  title: string;
  description: string;
  prompt: string;
  status: string;
  templateKey?: string;
  requirements: Array<{
    key: string;
    label: string;
    status: string;
    statusText: string;
    gap: string;
    alternative: string | null;
  }>;
};
type CatalogData = {
  isAdmin: boolean;
  lastSync: string | null;
  lastVerified: string | null;
  entities: Entity[];
  fields: ReportField[];
  totalJobs: number;
  hiddenByCategory: Record<string, number>;
  businessNames: Array<{ key: string; label: string; mapped: boolean; description: string | null }>;
  capabilities: Capability[];
  suggestions: Suggestion[];
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "fields", label: "Fields" },
  { key: "capabilities", label: "What's possible" },
  { key: "business", label: "Business names" },
  { key: "suggestions", label: "Suggested reports" },
] as const;

export function StatusBadge({ status, text }: { status: string; text: string }) {
  const tone =
    status === "ready"
      ? "bg-emerald-50 text-emerald-800"
      : status === "partial" || status === "ready_with_gaps"
        ? "bg-sky-50 text-sky-800"
        : status === "restricted"
          ? "bg-slate-100 text-slate-700"
          : status === "needs_mapping" ||
              status === "needs_business_rules" ||
              status === "needs_setup"
            ? "bg-amber-50 text-amber-800"
            : "bg-red-50 text-red-800";
  const Icon =
    status === "ready"
      ? CheckCircle2
      : status === "restricted"
        ? Lock
        : status === "partial" || status === "ready_with_gaps"
          ? CircleDashed
          : status.startsWith("needs")
            ? CircleAlert
            : XCircle;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {text}
    </span>
  );
}

const SUGGESTION_TEXT: Record<string, string> = {
  ready: "Ready to build",
  ready_with_gaps: "Ready, with gaps",
  needs_setup: "Needs setup",
  blocked: "Not possible yet",
};

export function SuggestionCard({ s }: { s: Suggestion }) {
  const href = s.templateKey ? null : `/reports/new?prompt=${encodeURIComponent(s.prompt)}`;
  const issues = s.requirements.filter((r) => r.status !== "ready");
  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--acton-border)] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-[var(--acton-navy)]">{s.title}</p>
        <StatusBadge status={s.status} text={SUGGESTION_TEXT[s.status] ?? s.status} />
      </div>
      <p className="mt-1 text-xs text-[var(--acton-muted)]">{s.description}</p>
      {issues.length ? (
        <ul className="mt-2 flex-1 space-y-1 text-xs text-[var(--acton-muted)]">
          {issues.map((r) => (
            <li key={r.key}>
              <span className="font-medium text-[var(--acton-navy)]">{r.label}:</span>{" "}
              {r.statusText}
              {r.gap ? ` — ${r.gap}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}
      {s.status !== "blocked" ? (
        <Link
          href={href ?? "/reports"}
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3 self-start")}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />{" "}
          {s.templateKey ? "Open templates" : "Build with Dexter"}
        </Link>
      ) : null}
    </div>
  );
}

export function DataCatalog() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const [entity, setEntity] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<CatalogData>("/api/reports/catalog"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const verify = async () => {
    setVerifying(true);
    setError(null);
    try {
      await aiFetch("/api/reports/catalog", {
        method: "POST",
        body: JSON.stringify({ action: "verify" }),
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  };

  const fields = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.fields ?? []).filter(
      (f) =>
        (source === "all" || f.source === source || (source === "custom" && f.custom)) &&
        (category === "all" || f.category === category) &&
        (!q || `${f.label} ${f.key} ${f.origin} ${f.description ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data, query, source, category]);

  if (!data)
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-sm text-[var(--acton-muted)]">Loading the data catalog…</p>
    );
  const selected = data.entities.find((e) => e.entity === entity) ?? null;
  const hiddenTotal = Object.values(data.hiddenByCategory).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Reports
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[var(--acton-navy)]">Data catalog</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            What Acton&apos;s JobTread connection actually exposes, verified against the live API —
            and what that makes possible in reports. Counts only; no record values are shown here.
          </p>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            Catalog verified {formatRelative(data.lastVerified)} · JobTread data synced{" "}
            {formatRelative(data.lastSync)}
          </p>
        </div>
        {data.isAdmin ? (
          <Button size="sm" variant="secondary" onClick={() => void verify()} disabled={verifying}>
            <RefreshCw className={cn("h-4 w-4", verifying && "animate-spin")} aria-hidden />{" "}
            {verifying ? "Verifying…" : "Re-verify catalog"}
          </Button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data.entities.length ? (
        <Notice tone="warning">
          The catalog hasn&apos;t been verified yet.{" "}
          {data.isAdmin ? "Choose Re-verify catalog." : "Ask an administrator to verify it."}
        </Notice>
      ) : null}
      {hiddenTotal ? (
        <Notice tone="info">
          {hiddenTotal} field(s) are hidden by your access:{" "}
          {Object.entries(data.hiddenByCategory)
            .map(([k, n]) => `${k} (${n})`)
            .join(", ")}
          .
        </Notice>
      ) : null}

      <nav
        aria-label="Catalog sections"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-[var(--acton-border)]"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key
                ? "border-[var(--acton-yellow)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ul className="space-y-2">
            {data.entities.map((e) => (
              <li key={e.entity}>
                <button
                  type="button"
                  onClick={() => setEntity(e.entity)}
                  className={cn(
                    "w-full rounded-lg border bg-white p-3 text-left hover:border-[var(--acton-navy)]",
                    entity === e.entity
                      ? "border-[var(--acton-navy)]"
                      : "border-[var(--acton-border)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--acton-navy)]">{e.label}</span>
                    <span className="text-sm text-[var(--acton-navy)] tabular-nums">
                      {e.record_count === null ? "—" : e.record_count.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {!e.accessible ? (
                      <StatusBadge status="unavailable" text="Not accessible" />
                    ) : e.record_count === 0 ? (
                      <StatusBadge status="unavailable" text="No records" />
                    ) : e.reportable ? (
                      <StatusBadge status="ready" text="In reports" />
                    ) : (
                      <StatusBadge status="partial" text="Verified, not synced" />
                    )}
                    <span className="text-[var(--acton-muted)]">
                      {e.fields.filter((f) => f.accessible).length} fields verified
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border border-[var(--acton-border)] bg-white p-4">
            {selected ? (
              <>
                <h2 className="font-semibold text-[var(--acton-navy)]">{selected.label}</h2>
                <p className="text-sm text-[var(--acton-muted)]">{selected.description}</p>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {selected.record_count?.toLocaleString() ?? "—"} records · related:{" "}
                  {selected.relationships.join(", ") || "—"} · verified{" "}
                  {formatDateTime(selected.last_verified_at)}
                </p>
                {selected.error ? (
                  <Notice tone="warning" className="mt-2">
                    {selected.error}
                  </Notice>
                ) : null}
                {selected.fields.length ? (
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-left text-xs text-[var(--acton-muted)]">
                      <tr>
                        <th className="py-1.5 pr-2 font-semibold">Field</th>
                        <th className="py-1.5 pr-2 font-semibold">Type</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">Populated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.fields.map((f) => (
                        <tr key={f.name} className="border-t border-[var(--acton-gray-100)]">
                          <td className="py-1.5 pr-2">
                            <p
                              className={cn(
                                "font-medium",
                                f.accessible
                                  ? "text-[var(--acton-navy)]"
                                  : "text-[var(--acton-muted)] line-through",
                              )}
                            >
                              {f.label}
                            </p>
                            <p className="text-xs text-[var(--acton-muted)]">{f.description}</p>
                          </td>
                          <td className="py-1.5 pr-2 text-xs text-[var(--acton-muted)]">
                            {f.relation ? `→ ${f.relation}` : f.type}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-xs tabular-nums">
                            {!f.accessible
                              ? "Not accessible"
                              : f.populated === null
                                ? f.relation
                                  ? "linked"
                                  : "not countable"
                                : `${f.populated.toLocaleString()} / ${selected.record_count?.toLocaleString()}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-3 text-sm text-[var(--acton-muted)]">
                    No fields to show — this entity has{" "}
                    {selected.record_count ? "records" : "no records"} in Acton&apos;s JobTread.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--acton-muted)]">
                Select an entity to see its verified fields and how many records have each one
                filled.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "fields" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="relative block w-full max-w-sm">
              <span className="sr-only">Search fields</span>
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--acton-muted)]"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fields"
                className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white pr-3 pl-9 text-sm"
              />
            </label>
            <select
              aria-label="Source"
              className={`${selectClass} h-9 w-48`}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All sources</option>
              <option value="jobs">Jobs</option>
              <option value="custom">Custom fields only</option>
              <option value="catalog_models">Product Library</option>
              <option value="cost_items">Cost items</option>
              <option value="commissions">Commissions</option>
            </select>
            <select
              aria-label="Category"
              className={`${selectClass} h-9 w-48`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              <option value="general">Project info</option>
              <option value="customer">Customer</option>
              <option value="financial">Financial</option>
              <option value="internal">Internal</option>
            </select>
            <span className="self-center text-xs text-[var(--acton-muted)]">
              {fields.length} of {data.fields.length} fields
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Field</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Filled</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const pct =
                    f.filled !== null && data.totalJobs ? f.filled / data.totalJobs : null;
                  return (
                    <tr key={f.key} className="border-t border-[var(--acton-gray-100)] align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium text-[var(--acton-navy)]">{f.label}</p>
                        <p className="text-xs text-[var(--acton-muted)]">
                          {f.description ?? f.origin}
                        </p>
                        {f.options.length ? (
                          <p className="text-xs text-[var(--acton-muted)]">
                            Options: {f.options.join(", ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--acton-muted)]">
                        {f.source === "jobs"
                          ? f.custom
                            ? `Custom · ${f.target}`
                            : "Job"
                          : f.source === "catalog_models"
                            ? "Product Library"
                            : f.source === "cost_items"
                              ? "Cost items"
                              : "Commissions (Baxter)"}
                      </td>
                      <td className="px-3 py-2 text-xs">{f.type}</td>
                      <td className="px-3 py-2 text-xs capitalize">{f.category}</td>
                      <td className="w-40 px-3 py-2">
                        {pct === null ? (
                          <span className="text-xs text-[var(--acton-muted)]">—</span>
                        ) : (
                          <div title={`${f.filled} of ${data.totalJobs} jobs`}>
                            <div className="h-1.5 rounded-full bg-[var(--acton-gray-100)]">
                              <div
                                className="h-1.5 rounded-full bg-[#2a78d6]"
                                style={{ width: `${Math.max(pct * 100, pct ? 2 : 0)}%` }}
                              />
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--acton-muted)] tabular-nums">
                              {f.filled} / {data.totalJobs}
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "capabilities" ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Business need</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">
                  What exists · what&apos;s missing · alternative
                </th>
              </tr>
            </thead>
            <tbody>
              {data.capabilities.map((c) => (
                <tr key={c.key} className="border-t border-[var(--acton-gray-100)] align-top">
                  <td className="px-3 py-2 font-medium text-[var(--acton-navy)]">{c.label}</td>
                  <td className="px-3 py-2 text-xs text-[var(--acton-muted)]">{c.source}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} text={c.statusText} />
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--acton-navy)]">
                    <p>{c.available}</p>
                    {c.gap ? <p className="text-[var(--acton-muted)]">{c.gap}</p> : null}
                    {c.alternative ? (
                      <p className="mt-0.5 text-sky-800">→ {c.alternative}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "business" ? (
        <div className="rounded-lg border border-[var(--acton-border)] bg-white p-4">
          <p className="text-sm text-[var(--acton-muted)]">
            Business names are what reports and Dexter use (“Recommended BR Model”).{" "}
            {data.isAdmin ? (
              <>
                Map them in{" "}
                <Link
                  className="font-semibold text-[var(--acton-navy)] underline"
                  href="/reports/settings"
                >
                  Data settings
                </Link>
                .
              </>
            ) : (
              "An administrator maps them to JobTread fields."
            )}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.businessNames.map((b) => (
              <li
                key={b.key}
                className="flex items-start justify-between gap-2 rounded-md border border-[var(--acton-gray-100)] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--acton-navy)]">{b.label}</p>
                  {!b.mapped && b.description ? (
                    <p className="text-xs text-[var(--acton-muted)]">{b.description}</p>
                  ) : null}
                </div>
                <StatusBadge
                  status={b.mapped ? "ready" : "needs_mapping"}
                  text={b.mapped ? "Mapped" : "Not mapped"}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "suggestions" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.suggestions.map((s) => (
            <SuggestionCard key={s.key} s={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type { Suggestion };
