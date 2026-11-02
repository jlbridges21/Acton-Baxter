"use client";

/**
 * Field Mapping Health (Reports → Data settings → Field catalog, admins): one validated row per
 * JobTread field and business name, keyed by JobTread field id.
 *   - counts by mapping status, sync status, and exclusion reason
 *   - search (current name, former name, id, ref) and filters
 *   - detail: identity, storage, issues, aliases, usage
 *   - actions: revalidate, include/exclude an eligible field in reports, resolve a review
 *     (confirm, or re-point a business name at an explicitly chosen field)
 * Nothing here widens access (Field access still decides who sees a field) or deletes data.
 */

import { useCallback, useState } from "react";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import { aiFetch, errorMessage, formatRelative, Notice, Pill, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Issue = { code: string; severity: "error" | "warning" | "info"; message: string };
type Result = {
  ref: string;
  kind: "field" | "alias";
  sourceRef: string;
  fieldId: string | null;
  entity: string;
  entityLabel: string;
  currentName: string;
  label: string;
  previousNames: string[];
  type: string;
  category: string | null;
  mappingStatus: string;
  syncStatus: string;
  reportable: boolean;
  reportingEnabled: boolean;
  toggleable: boolean;
  exclusion: { reason: string; label: string; detail: string } | null;
  issues: Issue[];
  target: string | null;
  aliases: string[];
  candidates: Array<{ id: string; name: string; target: string; type: string }>;
  repair: { id: string; name: string } | null;
  storage: string | null;
  dataset: string | null;
  usedBy: number;
  lastSeenAt: string | null;
  lastVerifiedAt: string | null;
};
type Summary = {
  total: number;
  fields: number;
  aliases: number;
  reportable: number;
  byMappingStatus: Record<string, number>;
  bySyncStatus: Record<string, number>;
  byExclusion: Record<string, number>;
  errors: number;
  warnings: number;
  needsReview: number;
};
type Page = {
  total: number;
  results: Result[];
  summary: Summary;
  validatedAt: string;
  schemaReady: boolean;
};

const card = "rounded-lg border border-[var(--acton-border)] bg-white p-5";
const TONE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-800",
  synced: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-900",
  needs_review: "bg-amber-50 text-amber-900",
  broken: "bg-red-50 text-red-800",
  stale: "bg-red-50 text-red-800",
  unmapped: "bg-slate-100 text-slate-700",
  not_synced: "bg-slate-100 text-slate-700",
  unsupported: "bg-slate-100 text-slate-700",
};
const EXCLUSIONS: Record<string, string> = {
  intentional: "Excluded on purpose",
  unsupported_api: "Not available from the API",
  not_synced: "Not synced",
  synced_not_exposed: "Synced, not in reports",
  permission: "Permission",
  broken_mapping: "Broken mapping",
};
const ISSUE_TONE = {
  error: "text-red-700",
  warning: "text-amber-800",
  info: "text-[var(--acton-muted)]",
};
const words = (s: string) => s.replace(/_/g, " ");

export function FieldMappingHealth() {
  const [page, setPage] = useState<Page | null>(null);
  const [q, setQ] = useState({ search: "", entity: "", status: "", exclusion: "", issues: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (next = q) => {
      const p = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
      setPage(await aiFetch<Page>(`/api/reports/admin/field-mappings?${p}`));
    },
    [q],
  );
  useLoad(
    useCallback(async () => {
      try {
        await load();
      } catch (e) {
        setError(errorMessage(e));
      }
    }, [load]),
  );

  const act = (body: Record<string, unknown>, done: string) =>
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await aiFetch("/api/reports/admin/field-mappings", {
          method: "POST",
          body: JSON.stringify(body),
        });
        await load();
        setNotice(done);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    })();
  const filter = (patch: Partial<typeof q>) => {
    const next = { ...q, ...patch };
    setQ(next);
    void load(next).catch((e: unknown) => setError(errorMessage(e)));
  };

  const s = page?.summary;
  return (
    <section className={card} aria-labelledby="mapping-health-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="mapping-health-title"
            className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden /> Field mapping health
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            Every field is matched by its permanent JobTread id, so renames keep working. Each field
            that can&apos;t be used in reports says why. Turning a field off keeps its data syncing;
            it never changes who may see it.
          </p>
          {page ? (
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Checked {formatRelative(page.validatedAt)}
            </p>
          ) : null}
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => act({ action: "revalidate" }, "Mappings revalidated.")}
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Revalidate
        </Button>
      </div>
      {page && !page.schemaReady ? (
        <Notice tone="warning" className="mt-3">
          Database migration 083 isn&apos;t applied yet. The health check runs, but switching fields
          on or off and resolving reviews need the migration.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="mt-3">
          {notice}
        </Notice>
      ) : null}

      {s ? (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Checked", s.total, ""],
            ["Usable in reports", s.reportable, ""],
            ["Errors", s.errors, "error"],
            ["Warnings", s.warnings, "warning"],
            ["Need review", s.needsReview, "review"],
            ["Not synced", s.bySyncStatus.not_synced ?? 0, "not_synced"],
          ].map(([name, value, key]) => (
            <button
              key={name as string}
              type="button"
              onClick={() =>
                filter(
                  key === "error" || key === "warning"
                    ? { issues: "1", status: "", exclusion: "" }
                    : key === "review"
                      ? { status: "needs_review", issues: "", exclusion: "" }
                      : key === "not_synced"
                        ? { status: "not_synced", issues: "", exclusion: "" }
                        : { status: "", issues: "", exclusion: "" },
                )
              }
              className="rounded-md border border-[var(--acton-gray-100)] px-3 py-2 text-left hover:border-[var(--acton-navy)]"
            >
              <dt className="text-xs text-[var(--acton-muted)]">{name}</dt>
              <dd className="text-lg font-semibold text-[var(--acton-navy)] tabular-nums">
                {value}
              </dd>
            </button>
          ))}
        </dl>
      ) : null}
      {s ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {Object.entries(s.byExclusion)
            .filter(([, n]) => n > 0)
            .map(([reason, n]) => (
              <button
                key={reason}
                type="button"
                onClick={() => filter({ exclusion: q.exclusion === reason ? "" : reason })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5",
                  q.exclusion === reason
                    ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                    : "border-[var(--acton-border)]",
                )}
              >
                {EXCLUSIONS[reason] ?? words(reason)} · {n}
              </button>
            ))}
        </div>
      ) : null}

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          filter({});
        }}
      >
        <label className="relative">
          <span className="sr-only">Search fields</span>
          <Search
            className="pointer-events-none absolute top-2.5 left-2 h-4 w-4 text-[var(--acton-muted)]"
            aria-hidden
          />
          <input
            value={q.search}
            onChange={(e) => setQ({ ...q, search: e.target.value })}
            placeholder="Name, former name, id, or ref"
            className="h-9 w-64 rounded-md border border-[var(--acton-border)] pr-2 pl-8 text-sm"
          />
        </label>
        <select
          aria-label="Entity"
          value={q.entity}
          onChange={(e) => filter({ entity: e.target.value })}
          className="h-9 rounded-md border border-[var(--acton-border)] px-2 text-sm"
        >
          <option value="">All entities</option>
          {[
            ["job", "Jobs"],
            ["location", "Locations"],
            ["customer", "Customers"],
            ["customerContact", "Customer contacts"],
            ["vendor", "Vendors"],
            ["vendorContact", "Vendor contacts"],
            ["dailyLog", "Daily logs"],
            ["costItem", "Cost items"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={q.status}
          onChange={(e) => filter({ status: e.target.value })}
          className="h-9 rounded-md border border-[var(--acton-border)] px-2 text-sm"
        >
          <option value="">Any status</option>
          {[
            "ok",
            "warning",
            "needs_review",
            "broken",
            "unmapped",
            "stale",
            "synced",
            "not_synced",
            "unsupported",
          ].map((v) => (
            <option key={v} value={v}>
              {words(v)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {page ? (
          <span className="text-xs text-[var(--acton-muted)]">
            {page.total} match{page.total === 1 ? "" : "es"}
            {page.total > page.results.length ? ` · first ${page.results.length} shown` : ""}
          </span>
        ) : null}
      </form>

      <ul className="mt-3 divide-y divide-[var(--acton-border)]">
        {(page?.results ?? []).map((r) => {
          const expanded = open === r.ref;
          return (
            <li key={r.ref} className="py-2 text-sm">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : r.ref)}
                className="flex w-full flex-wrap items-center gap-2 text-left"
              >
                <span className="font-semibold text-[var(--acton-navy)]">{r.label}</span>
                <code className="text-xs text-[var(--acton-muted)]">{r.ref}</code>
                <span className="text-xs text-[var(--acton-muted)]">{r.entityLabel}</span>
                <Pill className={TONE[r.mappingStatus] ?? ""}>{words(r.mappingStatus)}</Pill>
                <Pill className={TONE[r.syncStatus] ?? ""}>{words(r.syncStatus)}</Pill>
                {r.exclusion ? (
                  <Pill className="bg-slate-100 text-slate-700">{r.exclusion.label}</Pill>
                ) : null}
                {r.kind === "field" && !r.reportingEnabled ? (
                  <Pill className="bg-slate-100 text-slate-700">off for reports</Pill>
                ) : null}
              </button>
              {expanded ? (
                <div className="mt-2 space-y-2 rounded-md bg-[var(--acton-gray-50,#f8fafc)] p-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">JobTread name: </dt>
                      <dd className="inline">{r.currentName}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">Field id: </dt>
                      <dd className="inline">
                        <code>{r.fieldId ?? "—"}</code>
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline text-[var(--acton-muted)]">Source reference: </dt>
                      <dd className="inline">
                        <code className="break-all">{r.sourceRef}</code>
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">Type: </dt>
                      <dd className="inline">{r.type}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">Access category: </dt>
                      <dd className="inline">{r.category ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">Stored in: </dt>
                      <dd className="inline">{r.storage ?? "not stored"}</dd>
                    </div>
                    <div>
                      <dt className="inline text-[var(--acton-muted)]">Used by: </dt>
                      <dd className="inline">
                        {r.usedBy} report{r.usedBy === 1 ? "" : "s"}
                      </dd>
                    </div>
                    {r.previousNames.length ? (
                      <div className="sm:col-span-2">
                        <dt className="inline text-[var(--acton-muted)]">Former names: </dt>
                        <dd className="inline">{r.previousNames.join(", ")}</dd>
                      </div>
                    ) : null}
                    {r.aliases.length ? (
                      <div className="sm:col-span-2">
                        <dt className="inline text-[var(--acton-muted)]">Business names: </dt>
                        <dd className="inline">{r.aliases.join(", ")}</dd>
                      </div>
                    ) : null}
                    {r.target ? (
                      <div className="sm:col-span-2">
                        <dt className="inline text-[var(--acton-muted)]">Points at: </dt>
                        <dd className="inline">
                          <code>{r.target}</code>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {r.exclusion ? (
                    <p className="text-xs">
                      <span className="font-semibold">{r.exclusion.label}:</span>{" "}
                      {r.exclusion.detail}
                    </p>
                  ) : null}
                  {r.issues.length ? (
                    <ul className="space-y-0.5 text-xs" aria-label="Issues">
                      {r.issues.map((i) => (
                        <li key={i.code + i.message} className={ISSUE_TONE[i.severity]}>
                          <span className="font-semibold">{words(i.code)}</span> — {i.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-emerald-800">No problems found.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {r.kind === "field" && r.toggleable ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !page?.schemaReady}
                        onClick={() =>
                          act(
                            { action: "set_reporting", ref: r.ref, enabled: !r.reportingEnabled },
                            `${r.label} ${r.reportingEnabled ? "excluded from" : "included in"} reports.`,
                          )
                        }
                      >
                        {r.reportingEnabled ? "Exclude from reports" : "Include in reports"}
                      </Button>
                    ) : null}
                    {r.mappingStatus === "needs_review" && r.target ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !page?.schemaReady}
                        onClick={() =>
                          act(
                            { action: "resolve_review", ref: r.ref, resolution: "confirm" },
                            `${r.label} confirmed.`,
                          )
                        }
                      >
                        Confirm current field
                      </Button>
                    ) : null}
                    {r.kind === "alias" &&
                    (r.mappingStatus === "needs_review" || r.mappingStatus === "broken") ? (
                      <>
                        <label className="sr-only" htmlFor={`repoint-${r.ref}`}>
                          Field for {r.label}
                        </label>
                        <input
                          id={`repoint-${r.ref}`}
                          value={choice[r.ref] ?? r.repair?.id ?? ""}
                          onChange={(e) => setChoice({ ...choice, [r.ref]: e.target.value })}
                          placeholder="JobTread field id"
                          list={`cands-${r.ref}`}
                          className="h-8 w-48 rounded-md border border-[var(--acton-border)] px-2 text-xs"
                        />
                        <datalist id={`cands-${r.ref}`}>
                          {[...(r.repair ? [r.repair] : []), ...r.candidates].map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </datalist>
                        <Button
                          size="sm"
                          disabled={busy || !page?.schemaReady || !(choice[r.ref] ?? r.repair?.id)}
                          onClick={() =>
                            act(
                              {
                                action: "resolve_review",
                                ref: r.ref,
                                resolution: "repoint",
                                fieldId: choice[r.ref] ?? r.repair?.id,
                              },
                              `${r.label} now points at cf:${choice[r.ref] ?? r.repair?.id}.`,
                            )
                          }
                        >
                          Repair
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
