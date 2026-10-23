"use client";

import { useCallback, useState } from "react";
import { Loader2, Lock, RefreshCw } from "lucide-react";
import { aiFetch, errorMessage, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelative } from "@/lib/search/client";

type Latency = {
  samples: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  timeouts: number;
  errors: number;
  since: string | null;
};

type ProviderView = {
  id: string;
  name: string;
  categoryLabel: string;
  source: string;
  description: string;
  indexing: "registry" | "live" | "index";
  optional: boolean;
  enabled: boolean;
  permissionSummary: string;
  available: boolean;
  availabilityReason: string | null;
  timeoutMs: number;
  minQueryLength: number;
  fields: Array<{
    key: string;
    label: string;
    sensitivity: "standard" | "restricted";
    enabled: boolean;
  }>;
  index: {
    status: string;
    lastIndexedAt: string | null;
    count: number;
    durationMs: number | null;
    error: string | null;
    trigger: string | null;
    refreshMinutes: number | null;
  } | null;
  latency: Latency | null;
};

type Overview = {
  providers: ProviderView[];
  overall: Latency;
  synonyms: Array<{ term: string; synonyms: string[] }>;
};

type Diagnose = {
  tookMs: number | null;
  providers: Array<{
    provider: string;
    name: string;
    status: string;
    count: number;
    latencyMs: number;
    message: string | null;
  }>;
};

const INDEXING_LABEL = { registry: "Registry", live: "Live query", index: "Indexed" } as const;

function ms(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v} ms`;
}

export function SearchAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [alts, setAlts] = useState("");
  const [diagQuery, setDiagQuery] = useState("");
  const [diag, setDiag] = useState<Diagnose | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Overview>("/api/admin/search"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  async function command(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await aiFetch<Record<string, unknown>>("/api/admin/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (done) setNotice(done);
      await load();
      return res;
    } catch (e) {
      setNotice(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--acton-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          role="status"
          className="rounded-md bg-[var(--acton-gray-100)] px-3 py-2 text-sm text-[var(--acton-navy)]"
        >
          {notice}
        </p>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--acton-navy)]">
              Performance (measured)
            </h2>
            <p className="text-xs text-[var(--acton-muted)]">
              Whole-search latency on this server instance
              {data.overall.since ? ` since ${new Date(data.overall.since).toLocaleString()}` : ""}.
              Each serverless instance keeps its own samples.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void command(
                "reindex-all",
                { op: "reindex", provider: "all" },
                "Indexed providers refreshed.",
              )
            }
          >
            {busy === "reindex-all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Reindex all
          </Button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Searches sampled" value={String(data.overall.samples)} />
          <Stat label="p50" value={ms(data.overall.p50)} />
          <Stat label="p95" value={ms(data.overall.p95)} />
          <Stat label="Slowest" value={ms(data.overall.max)} />
        </dl>
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!diagQuery.trim()) return;
            void command("diagnose", { op: "diagnose", query: diagQuery.trim() }).then(
              (r) => r && setDiag(r as unknown as Diagnose),
            );
          }}
        >
          <label className="flex-1 text-xs font-semibold text-[var(--acton-muted)]">
            Test a query (runs as you; shows timing and counts only)
            <input
              value={diagQuery}
              maxLength={120}
              onChange={(e) => setDiagQuery(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
            />
          </label>
          <Button size="sm" type="submit" disabled={busy !== null || !diagQuery.trim()}>
            Run
          </Button>
        </form>
        {diag ? (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-[var(--acton-muted)]">
              <tr>
                <th className="py-1">Provider</th>
                <th>Status</th>
                <th>Results</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {diag.providers.map((p) => (
                <tr key={p.provider} className="border-t border-[var(--acton-border)]">
                  <td className="py-1">{p.name}</td>
                  <td title={p.message ?? undefined}>{p.status}</td>
                  <td>{p.count}</td>
                  <td>{ms(p.latencyMs)}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--acton-border)] font-semibold">
                <td className="py-1">Total</td>
                <td />
                <td />
                <td>{ms(diag.tookMs)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </Card>

      <div className="space-y-4">
        {data.providers.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--acton-navy)]">{p.name}</h3>
                <p className="text-xs text-[var(--acton-muted)]">
                  {p.categoryLabel} · {p.source} · {INDEXING_LABEL[p.indexing]} · timeout{" "}
                  {p.timeoutMs} ms
                </p>
                <p className="mt-1 text-sm text-[var(--acton-muted)]">{p.description}</p>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  <span className="font-semibold">Access:</span> {p.permissionSummary}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.available ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}
                >
                  {p.available ? "Available" : (p.availabilityReason ?? "Unavailable")}
                </span>
                {p.optional ? (
                  <label className="flex items-center gap-2 text-xs text-[var(--acton-navy)]">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={busy !== null}
                      onChange={(e) =>
                        void command(`enable-${p.id}`, {
                          op: "set_enabled",
                          provider: p.id,
                          enabled: e.target.checked,
                        })
                      }
                    />
                    Enabled
                  </label>
                ) : (
                  <span className="text-xs text-[var(--acton-muted)]">
                    Core provider (always on)
                  </span>
                )}
              </div>
            </div>

            {p.index ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-[var(--acton-gray-50)] px-3 py-2 text-xs text-[var(--acton-navy)]">
                <span>
                  Index: <strong>{p.index.status}</strong>
                </span>
                <span>{p.index.count} records</span>
                <span>Last refresh {formatRelative(p.index.lastIndexedAt) ?? "never"}</span>
                <span>Took {ms(p.index.durationMs)}</span>
                {p.index.refreshMinutes ? <span>Every {p.index.refreshMinutes} min</span> : null}
                {p.index.error ? (
                  <span className="text-red-700">Last failure: {p.index.error}</span>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  disabled={busy !== null || !p.enabled}
                  onClick={() =>
                    void command(
                      `reindex-${p.id}`,
                      { op: "reindex", provider: p.id },
                      `${p.name} reindexed.`,
                    )
                  }
                >
                  {busy === `reindex-${p.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Reindex
                </Button>
              </div>
            ) : null}

            {p.latency ? (
              <p className="mt-2 text-xs text-[var(--acton-muted)]">
                Measured: {p.latency.samples} runs · p50 {ms(p.latency.p50)} · p95{" "}
                {ms(p.latency.p95)} · {p.latency.timeouts} timeouts · {p.latency.errors} errors
              </p>
            ) : null}

            <fieldset className="mt-3">
              <legend className="text-xs font-semibold text-[var(--acton-muted)]">
                Searchable fields
              </legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {p.fields.map((f) =>
                  f.sensitivity === "restricted" ? (
                    <span
                      key={f.key}
                      title="Restricted: never searchable or shown"
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--acton-border)] px-2 py-0.5 text-xs text-[var(--acton-muted)]"
                    >
                      <Lock className="h-3 w-3" aria-hidden /> {f.label}
                    </span>
                  ) : (
                    <label
                      key={f.key}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--acton-border)] px-2 py-0.5 text-xs text-[var(--acton-navy)]"
                    >
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        disabled={busy !== null}
                        onChange={(e) => {
                          const next = p.fields
                            .filter(
                              (x) =>
                                x.sensitivity === "standard" &&
                                (x.key === f.key ? e.target.checked : x.enabled),
                            )
                            .map((x) => x.key);
                          void command(
                            `fields-${p.id}`,
                            { op: "set_fields", provider: p.id, fields: next },
                            "Searchable fields saved.",
                          );
                        }}
                      />
                      {f.label}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-base font-semibold text-[var(--acton-navy)]">Synonyms</h2>
        <p className="text-xs text-[var(--acton-muted)]">
          Searching either word finds the other (for example “hr” ↔ “bamboohr”). Synonym matches
          never outrank direct matches.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void command(
              "synonym",
              {
                op: "upsert_synonym",
                term,
                synonyms: alts
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
              "Synonyms saved.",
            ).then((r) => {
              if (r) {
                setTerm("");
                setAlts("");
              }
            });
          }}
        >
          <label className="text-xs font-semibold text-[var(--acton-muted)]">
            Term
            <input
              value={term}
              maxLength={40}
              onChange={(e) => setTerm(e.target.value)}
              className="mt-1 block rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
            />
          </label>
          <label className="flex-1 text-xs font-semibold text-[var(--acton-muted)]">
            Synonyms (comma separated)
            <input
              value={alts}
              onChange={(e) => setAlts(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
            />
          </label>
          <Button size="sm" type="submit" disabled={busy !== null || !term.trim() || !alts.trim()}>
            Save
          </Button>
        </form>
        <ul className="mt-3 divide-y divide-[var(--acton-border)] text-sm">
          {data.synonyms.map((s) => (
            <li key={s.term} className="flex items-center justify-between py-2">
              <span>
                <strong>{s.term}</strong> ↔ {s.synonyms.join(", ")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void command(
                    `del-${s.term}`,
                    { op: "delete_synonym", term: s.term },
                    "Synonym removed.",
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
          {data.synonyms.length === 0 ? (
            <li className="py-2 text-xs text-[var(--acton-muted)]">No synonyms yet.</li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--acton-gray-50)] px-3 py-2">
      <dt className="text-xs text-[var(--acton-muted)]">{label}</dt>
      <dd className="font-semibold text-[var(--acton-navy)]">{value}</dd>
    </div>
  );
}
