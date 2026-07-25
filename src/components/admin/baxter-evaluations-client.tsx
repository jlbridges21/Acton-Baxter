"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type SuiteSummary = {
  total: number;
  passed: number;
  failed: number;
  byCategory: Record<string, { passed: number; failed: number }>;
  results: Array<{
    caseId: string;
    question: string;
    category: string;
    passed: boolean;
    actualAnswer: string;
    expectedAnswer: string | null;
    retrievalMode: string;
    sources: Array<{ title: string }>;
    signals: { factsFound: string[]; factsMissing: string[] };
  }>;
};

export function BaxterEvaluationsClient({
  initialCases,
}: {
  initialCases: Array<{ id: string; question: string; category: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SuiteSummary | null>(null);
  const [cases, setCases] = useState(initialCases);
  const [error, setError] = useState<string | null>(null);

  async function loadCases() {
    const res = await fetch("/api/admin/baxter/evaluations");
    const data = (await res.json()) as {
      cases?: Array<{ id: string; question: string; category: string }>;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Failed to load cases");
      return;
    }
    setCases(data.cases ?? []);
  }

  async function runSuite() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_suite" }),
      });
      const data = (await res.json()) as SuiteSummary & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Suite failed");
        return;
      }
      setSummary(data);
    } finally {
      setBusy(false);
    }
  }

  async function runOne(caseId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_one", caseId }),
      });
      const data = (await res.json()) as { result?: SuiteSummary["results"][0]; error?: string };
      if (!res.ok || !data.result) {
        setError(data.error ?? "Case failed");
        return;
      }
      setSummary((prev) => {
        const results = [data.result!, ...(prev?.results ?? []).filter((r) => r.caseId !== caseId)];
        const passed = results.filter((r) => r.passed).length;
        return {
          total: results.length,
          passed,
          failed: results.length - passed,
          byCategory: prev?.byCategory ?? {},
          results,
        };
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <CardTitle>Suite</CardTitle>
        <CardDescription>
          Runs deterministic fact and source checks. Does not expose chain-of-thought.
        </CardDescription>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void runSuite()}>
            Run enabled suite
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void loadCases()}>
            Refresh cases
          </Button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {summary ? (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-[var(--acton-muted)]">Total</span>
              <p className="font-semibold">{summary.total}</p>
            </div>
            <div>
              <span className="text-[var(--acton-muted)]">Passed</span>
              <p className="font-semibold text-emerald-700">{summary.passed}</p>
            </div>
            <div>
              <span className="text-[var(--acton-muted)]">Failed</span>
              <p className="font-semibold text-red-700">{summary.failed}</p>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle>Cases</CardTitle>
        <ul className="space-y-2">
          {cases.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--acton-border)] px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{c.question}</p>
                <p className="text-xs text-[var(--acton-muted)]">{c.category}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void runOne(c.id)}
              >
                Run one
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {summary?.results?.length ? (
        <Card className="space-y-3 p-4">
          <CardTitle>Results</CardTitle>
          <ul className="space-y-3">
            {summary.results.map((r) => (
              <li
                key={r.caseId}
                className="rounded-lg border border-[var(--acton-border)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{r.question}</p>
                  <span className={r.passed ? "text-emerald-700" : "text-red-700"}>
                    {r.passed ? "Pass" : "Fail"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  Mode: {r.retrievalMode} · Sources:{" "}
                  {r.sources.map((s) => s.title).join(", ") || "—"}
                </p>
                <p className="mt-1">
                  <span className="text-[var(--acton-muted)]">Expected:</span>{" "}
                  {r.expectedAnswer ?? "—"}
                </p>
                <p className="mt-1 line-clamp-4">
                  <span className="text-[var(--acton-muted)]">Actual:</span> {r.actualAnswer || "—"}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
