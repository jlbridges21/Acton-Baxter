"use client";

/**
 * Region rules (Reports → Data settings, admins). JobTread has no "region" on catalog models;
 * a name like "LA - i 498" only hints at one. Admins confirm the meaning here, and reports
 * use the result as model.region. Unmatched models stay unmapped — never guessed.
 */

import { useCallback, useState } from "react";
import { MapPin, Trash2 } from "lucide-react";
import { aiFetch, errorMessage, Notice, selectClass, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";

type Overview = {
  rules: Array<{
    id: string;
    matchType: "prefix" | "exact" | "contains";
    pattern: string;
    value: string;
    priority: number;
  }>;
  models: Array<{ id: string; name: string; region: string | null }>;
  suggestions: Array<{ pattern: string; count: number; examples: string[] }>;
};

const MATCH_LABEL = { prefix: "starts with", exact: "is exactly", contains: "contains" };

export function RegionMappings() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ matchType: "prefix", pattern: "", value: "" });

  const load = useCallback(async () => {
    try {
      setData(await aiFetch<Overview>("/api/reports/admin/mappings"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(load);

  const send = async (method: "POST" | "DELETE", body?: unknown, id?: string) => {
    setBusy(true);
    setError(null);
    try {
      setData(
        await aiFetch<Overview>(
          `/api/reports/admin/mappings${id ? `?id=${encodeURIComponent(id)}` : ""}`,
          { method, ...(body ? { body: JSON.stringify(body) } : {}) },
        ),
      );
      if (method === "POST") setDraft({ matchType: "prefix", pattern: "", value: "" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const unmapped = data?.models.filter((m) => !m.region) ?? [];

  return (
    <section
      aria-labelledby="region-title"
      className="rounded-lg border border-[var(--acton-border)] bg-white p-5"
    >
      <h2
        id="region-title"
        className="flex items-center gap-2 font-semibold text-[var(--acton-navy)]"
      >
        <MapPin className="h-4 w-4" aria-hidden /> Regions for Product Library models
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[var(--acton-muted)]">
        Reports group models by <strong>Region</strong> (model.region) only through these rules. A
        prefix like “LA -” isn&apos;t treated as a location until you map it here.
      </p>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
      {!data && !error ? <p className="mt-3 text-sm text-[var(--acton-muted)]">Loading…</p> : null}
      {data ? (
        <>
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("POST", {
                kind: "region",
                sourceField: "model.name",
                matchType: draft.matchType,
                pattern: draft.pattern,
                value: draft.value,
              });
            }}
          >
            <span className="pb-2 text-sm text-[var(--acton-navy)]">Model name</span>
            <div className="w-36">
              <select
                aria-label="Match type"
                className={`${selectClass} h-9`}
                value={draft.matchType}
                onChange={(e) => setDraft({ ...draft, matchType: e.target.value })}
              >
                <option value="prefix">starts with</option>
                <option value="exact">is exactly</option>
                <option value="contains">contains</option>
              </select>
            </div>
            <input
              aria-label="Pattern"
              required
              maxLength={120}
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
              placeholder="LA -"
              className="h-9 w-32 rounded-md border border-[var(--acton-border)] px-3 text-sm"
            />
            <span className="pb-2 text-sm text-[var(--acton-navy)]">→ region</span>
            <input
              aria-label="Region"
              required
              maxLength={120}
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              placeholder="Los Angeles"
              className="h-9 w-44 rounded-md border border-[var(--acton-border)] px-3 text-sm"
            />
            <Button size="sm" type="submit" disabled={busy}>
              Add rule
            </Button>
          </form>

          {data.suggestions.length ? (
            <p className="mt-3 text-xs text-[var(--acton-muted)]">
              Prefixes seen in unmapped model names (not mapped until you add a rule):{" "}
              {data.suggestions.map((s) => (
                <button
                  key={s.pattern}
                  type="button"
                  className="mr-2 rounded bg-[var(--acton-gray-50)] px-1.5 py-0.5 font-mono text-[var(--acton-navy)] hover:bg-[var(--acton-gray-100)]"
                  title={s.examples.join(", ")}
                  onClick={() => setDraft({ ...draft, matchType: "prefix", pattern: s.pattern })}
                >
                  {s.pattern} ({s.count})
                </button>
              ))}
            </p>
          ) : null}

          <ul className="mt-4 divide-y divide-[var(--acton-gray-100)] text-sm">
            {data.rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  Model name {MATCH_LABEL[r.matchType]}{" "}
                  <code className="rounded bg-[var(--acton-gray-50)] px-1">{r.pattern}</code> →{" "}
                  <strong>{r.value}</strong>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send("DELETE", undefined, r.id)}
                  className="rounded p-1 text-[var(--acton-muted)] hover:bg-red-50 hover:text-red-700"
                  aria-label={`Delete rule ${r.pattern}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
            {data.rules.length === 0 ? (
              <li className="py-2 text-[var(--acton-muted)]">No region rules yet.</li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs text-[var(--acton-muted)]">
            {data.models.length - unmapped.length} of {data.models.length} models have a region.
            {unmapped.length
              ? ` Unmapped: ${unmapped
                  .slice(0, 6)
                  .map((m) => m.name)
                  .join(", ")}${unmapped.length > 6 ? "…" : ""}`
              : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
