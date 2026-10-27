"use client";

/**
 * /reports/settings/health (admins): freshness of every synced dataset, the reports whose
 * numbers are affected, and mapping/governance gaps.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, RefreshCw } from "lucide-react";
import { aiFetch, errorMessage, formatRelative, Notice, Pill, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { STATUS_STYLE } from "./sync-manager";

type Dashboard = {
  configured: boolean;
  summary: {
    fresh: number;
    attention: number;
    disabled: number;
    reportsAffected: number;
    reportsChecked: number;
  };
  datasets: Array<{
    key: string;
    label: string;
    enabled: boolean;
    status: string;
    level: string;
    message: string | null;
    lastSuccessAt: string | null;
    recordsCached: number | null;
    sourceCount: number | null;
    coverage: number | null;
    droppedFields: string[];
    reportsUsing: number;
    dependsOn: string[];
  }>;
  reportsAffected: Array<{
    id: string;
    title: string;
    datasets: string[];
    warnings: string[];
    widgetsAffected: number;
  }>;
  staticNotes: Array<{
    reportId: string;
    reportTitle: string;
    widgetId: string;
    title: string;
    excerpt: string;
  }>;
  mappings: {
    semanticTotal: number;
    semanticUnmapped: number;
    regionRules: number;
    productModels: number;
    modelsWithoutRegion: number;
    suggestedPrefixes: Array<{ pattern: string; count: number }>;
  };
  customFieldTargets: Array<{ target: string; total: number; excluded: number }>;
};

const LEVEL: Record<string, { label: string; tone: string }> = {
  fresh: { label: "Fresh", tone: "bg-emerald-50 text-emerald-800" },
  stale: { label: "Stale", tone: "bg-amber-50 text-amber-900" },
  never: { label: "Never synced", tone: "bg-slate-100 text-slate-700" },
  failed: { label: "Last run failed", tone: "bg-red-50 text-red-800" },
  disabled: { label: "Off", tone: "bg-slate-100 text-slate-600" },
  running: { label: "Syncing", tone: "bg-indigo-50 text-indigo-800" },
  not_configured: { label: "Not connected", tone: "bg-slate-100 text-slate-700" },
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--acton-border)] bg-white p-4">
      <p className="text-xs text-[var(--acton-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-[var(--acton-navy)]"}`}>
        {value}
      </p>
    </div>
  );
}

export function DataHealth() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await aiFetch<Dashboard>("/api/reports/admin/health"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useLoad(load);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link
            href="/reports/settings"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Data settings
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-[var(--acton-navy)]">
            <Activity className="h-5 w-5" aria-hidden /> Data health
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
            How fresh each JobTread dataset is, which reports are affected, and what still needs
            mapping.
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!data && !error ? <p className="text-sm text-[var(--acton-muted)]">Loading…</p> : null}
      {data ? (
        <>
          {!data.configured ? (
            <Notice tone="warning">
              JobTread isn&apos;t connected, so no dataset can refresh. Reports show the last cached
              data.
            </Notice>
          ) : null}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Fresh datasets" value={data.summary.fresh} tone="text-emerald-700" />
            <Stat
              label="Need attention"
              value={data.summary.attention}
              tone={data.summary.attention ? "text-amber-800" : undefined}
            />
            <Stat label="Turned off" value={data.summary.disabled} />
            <Stat
              label="Reports affected"
              value={`${data.summary.reportsAffected} / ${data.summary.reportsChecked}`}
              tone={data.summary.reportsAffected ? "text-amber-800" : undefined}
            />
          </section>

          <section className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--acton-navy)]">Datasets</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs text-[var(--acton-muted)]">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Dataset</th>
                    <th className="py-2 pr-3 font-semibold">Freshness</th>
                    <th className="py-2 pr-3 font-semibold">Sync status</th>
                    <th className="py-2 pr-3 text-right font-semibold">Coverage</th>
                    <th className="py-2 pr-3 text-right font-semibold">Reports using</th>
                    <th className="py-2 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.datasets.map((d) => {
                    const lvl = LEVEL[d.level] ?? { label: d.level, tone: "" };
                    const st = STATUS_STYLE[d.status] ?? { label: d.status, tone: "" };
                    return (
                      <tr key={d.key} className="border-t border-[var(--acton-gray-100)] align-top">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-[var(--acton-navy)]">{d.label}</p>
                          <p className="text-xs text-[var(--acton-muted)]">
                            Last good: {formatRelative(d.lastSuccessAt)}
                          </p>
                        </td>
                        <td className="py-2 pr-3">
                          <Pill className={lvl.tone}>{lvl.label}</Pill>
                        </td>
                        <td className="py-2 pr-3">
                          <Pill className={st.tone}>{st.label}</Pill>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {d.coverage !== null
                            ? `${Math.round(d.coverage * 100)}%`
                            : d.recordsCached !== null
                              ? d.recordsCached.toLocaleString()
                              : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{d.reportsUsing}</td>
                        <td className="py-2 text-xs">
                          {d.message ? <p className="text-amber-900">{d.message}</p> : null}
                          {d.droppedFields.length ? (
                            <p className="text-[var(--acton-muted)]">
                              Not exposed by JobTread: {d.droppedFields.join(", ")}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              Coverage compares cached records with the count verified in the Data catalog. Manage
              datasets in{" "}
              <Link href="/reports/settings" className="underline">
                Data settings → Sync manager
              </Link>
              .
            </p>
          </section>

          <section className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
            <h2 className="font-semibold text-[var(--acton-navy)]">Reports affected</h2>
            {data.reportsAffected.length ? (
              <ul className="mt-3 divide-y divide-[var(--acton-gray-100)] text-sm">
                {data.reportsAffected.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link
                      href={`/reports/${r.id}`}
                      className="font-medium text-[var(--acton-navy)] hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="text-xs text-[var(--acton-muted)]">
                      {" "}
                      · {r.widgetsAffected} widget{r.widgetsAffected === 1 ? "" : "s"} ·{" "}
                      {r.datasets.join(", ")}
                    </span>
                    <ul className="mt-1 list-disc pl-5 text-xs text-amber-900">
                      {r.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--acton-muted)]">
                Every report&apos;s data is fresh.
              </p>
            )}
          </section>

          {data.staticNotes.length ? (
            <section className="rounded-lg border border-[var(--acton-border)] bg-white p-5">
              <h2 className="font-semibold text-[var(--acton-navy)]">Text notes to review</h2>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                These report notes state data facts (counts, import or sync status) that may be out
                of date. They&apos;re never changed automatically — replace them with KPI or Data
                status widgets, or edit the note.
              </p>
              <ul className="mt-3 divide-y divide-[var(--acton-gray-100)] text-sm">
                {data.staticNotes.map((n) => (
                  <li key={`${n.reportId}-${n.widgetId}`} className="py-2">
                    <Link
                      href={`/reports/${n.reportId}`}
                      className="font-medium text-[var(--acton-navy)] hover:underline"
                    >
                      {n.reportTitle}
                    </Link>
                    <span className="text-xs text-[var(--acton-muted)]">
                      {" "}
                      · {n.title || n.widgetId}
                    </span>
                    <p className="mt-0.5 text-xs text-amber-900">“…{n.excerpt}…”</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--acton-border)] bg-white p-5 text-sm">
              <h2 className="font-semibold text-[var(--acton-navy)]">Mappings</h2>
              <ul className="mt-2 space-y-1">
                <li>
                  Business fields mapped:{" "}
                  <strong>
                    {data.mappings.semanticTotal - data.mappings.semanticUnmapped} /{" "}
                    {data.mappings.semanticTotal}
                  </strong>
                </li>
                <li>
                  Product Library models with a region:{" "}
                  <strong>
                    {data.mappings.productModels - data.mappings.modelsWithoutRegion} /{" "}
                    {data.mappings.productModels}
                  </strong>{" "}
                  ({data.mappings.regionRules} rule{data.mappings.regionRules === 1 ? "" : "s"})
                </li>
                {data.mappings.suggestedPrefixes.length ? (
                  <li className="text-xs text-[var(--acton-muted)]">
                    Unmapped prefixes:{" "}
                    {data.mappings.suggestedPrefixes
                      .map((p) => `${p.pattern} (${p.count})`)
                      .join(", ")}
                  </li>
                ) : null}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--acton-border)] bg-white p-5 text-sm">
              <h2 className="font-semibold text-[var(--acton-navy)]">Custom fields by target</h2>
              <ul className="mt-2 space-y-1">
                {data.customFieldTargets.map((t) => (
                  <li key={t.target} className="flex justify-between">
                    <span className="capitalize">{t.target}</span>
                    <span className="text-[var(--acton-muted)] tabular-nums">
                      {t.total - t.excluded} used · {t.excluded} excluded
                    </span>
                  </li>
                ))}
                {data.customFieldTargets.length === 0 ? (
                  <li className="text-[var(--acton-muted)]">No custom fields discovered yet.</li>
                ) : null}
              </ul>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
