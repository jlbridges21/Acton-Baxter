"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { ASSESSMENT_CATEGORY_LABELS, type AssessmentCategoryKey } from "@/lib/pem-neat/constants";

type Tab = "neat" | "buildertrend";

function formatLabel(value: string | null | undefined) {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

function isStructuredResult(value: unknown): value is PemNeatStructuredResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    "salesIntelligence" in value &&
    "assessment" in value &&
    "followUpEmail" in value,
  );
}

export function PemNeatResultClient({ item }: { item: PemNeatRecord }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("neat");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = isStructuredResult(item.structured_result) ? item.structured_result : null;
  const bt = result?.buildertrendFields ?? item.buildertrend_fields;

  async function onRegenerate() {
    setError(null);
    setRegenerating(true);
    try {
      const response = await fetch(`/api/pem-neats/${item.id}/generate`, { method: "POST" });
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(data.error?.message ?? "Regeneration failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/pem-neats"
          className="text-sm font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          ← Back to library
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{item.prospect_name}</h1>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              {item.salesperson_display_name}
              {item.meeting_date ? ` • ${item.meeting_date}` : ""}
              {item.generated_at
                ? ` • Generated ${new Date(item.generated_at).toLocaleString()}`
                : ""}
            </p>
            <p className="mt-1 text-sm text-[var(--acton-navy)]">
              Outcome: <span className="font-semibold">{formatLabel(item.meeting_outcome)}</span>
              {item.qualification ? (
                <>
                  {" "}
                  · Qualification:{" "}
                  <span className="font-semibold">{formatLabel(item.qualification)}</span>
                </>
              ) : null}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onRegenerate}
            disabled={regenerating || item.status === "generating"}
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      </div>

      {item.status === "failed" || item.generation_error ? (
        <Card className="border-red-200 bg-red-50">
          <CardTitle className="text-red-900">Generation issue</CardTitle>
          <CardDescription className="text-red-800">
            {item.generation_error ?? "Generation failed."} Your transcript was preserved — you can
            retry.
          </CardDescription>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {regenerating || item.status === "generating" ? (
        <Card>
          <CardTitle>Analyzing Partnership Evaluation Meeting…</CardTitle>
          <CardDescription>
            Extracting customer intelligence and evaluating the Acton sales process.
          </CardDescription>
        </Card>
      ) : null}

      <div className="flex gap-2 border-b border-[var(--acton-border)]">
        <button
          type="button"
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-semibold",
            tab === "neat"
              ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
              : "border-transparent text-[var(--acton-muted)]",
          )}
          onClick={() => setTab("neat")}
        >
          NEAT
        </button>
        <button
          type="button"
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-semibold",
            tab === "buildertrend"
              ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
              : "border-transparent text-[var(--acton-muted)]",
          )}
          onClick={() => setTab("buildertrend")}
        >
          BuilderTrend Custom Fields
        </button>
      </div>

      {tab === "neat" ? (
        <div className="space-y-4">
          {!result ? (
            <Card>
              <CardTitle>NEAT not available yet</CardTitle>
              <CardDescription>
                Structured analysis has not been saved for this record.
              </CardDescription>
            </Card>
          ) : (
            <>
              <Card>
                <CardTitle>Notes — Sales intelligence</CardTitle>
                <div className="mt-3 space-y-3 text-sm text-[var(--acton-navy)]">
                  <Section label="Customer story" body={result.salesIntelligence.customerStory} />
                  <Section label="Customer pain" body={result.salesIntelligence.customerPain} />
                  <div>
                    <p className="font-medium">Type 1 pain</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {result.salesIntelligence.type1Pain.map((p, i) => (
                        <li key={i}>{p.statement}</li>
                      ))}
                      {result.salesIntelligence.type1Pain.length === 0 ? (
                        <li className="list-none text-[var(--acton-muted)]">Not established</li>
                      ) : null}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">Type 2 pain</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {result.salesIntelligence.type2Pain.map((p, i) => (
                        <li key={i}>{p.statement}</li>
                      ))}
                      {result.salesIntelligence.type2Pain.length === 0 ? (
                        <li className="list-none text-[var(--acton-muted)]">Not established</li>
                      ) : null}
                    </ul>
                  </div>
                  <Section
                    label="Budget summary"
                    body={
                      result.salesIntelligence.budget.summary ?? "See structured budget fields."
                    }
                  />
                  <Section
                    label="Meeting outcome"
                    body={`${result.salesIntelligence.meetingOutcome.classification}: ${result.salesIntelligence.meetingOutcome.explanation}`}
                  />
                  <Section
                    label="Next steps (Acton)"
                    body={result.salesIntelligence.nextSteps.acton.join("; ") || "—"}
                  />
                </div>
              </Card>

              <Card>
                <CardTitle>Email — Customer follow-up</CardTitle>
                {result.followUpEmail.subject ? (
                  <p className="mt-2 text-sm font-medium text-[var(--acton-navy)]">
                    Subject: {result.followUpEmail.subject}
                  </p>
                ) : null}
                <pre className="mt-3 rounded-md bg-[var(--acton-gray-50)] p-3 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                  {result.followUpEmail.body}
                </pre>
              </Card>

              <Card>
                <CardTitle>Assessment</CardTitle>
                <p className="mt-2 text-sm text-[var(--acton-navy)]">
                  <span className="font-medium">The One Thing:</span> {result.assessment.oneThing}
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-[var(--acton-muted)]">
                      <tr>
                        <th className="py-2 pr-3">Category</th>
                        <th className="py-2 pr-3">Score</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.assessment.categories.map((cat) => (
                        <tr key={cat.key} className="border-t border-[var(--acton-border)]">
                          <td className="py-2 pr-3 font-medium">
                            {ASSESSMENT_CATEGORY_LABELS[cat.key as AssessmentCategoryKey] ??
                              cat.label}
                          </td>
                          <td className="py-2 pr-3">{cat.score ?? "—"}</td>
                          <td className="py-2 pr-3">{cat.status}</td>
                          <td className="py-2 text-[var(--acton-muted)]">{cat.evidence ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <CardTitle>Project intelligence</CardTitle>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
                  {result.projectIntelligence.facts.map((fact, i) => (
                    <li key={i}>
                      <span className="font-medium">{fact.topic}:</span> {fact.value ?? "—"}{" "}
                      <span className="text-[var(--acton-muted)]">({fact.status})</span>
                    </li>
                  ))}
                  {result.projectIntelligence.facts.length === 0 ? (
                    <li className="list-none text-[var(--acton-muted)]">No facts captured</li>
                  ) : null}
                </ul>
              </Card>

              <Card>
                <CardTitle>Internal opportunity notes</CardTitle>
                <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                  {result.internalOpportunityNotes || "—"}
                </p>
              </Card>

              <Card>
                <CardTitle>Original transcript</CardTitle>
                <CardDescription>Stored exactly as entered (source of truth).</CardDescription>
                <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap text-[var(--acton-navy)]">
                  {item.transcript}
                </pre>
              </Card>
            </>
          )}
        </div>
      ) : (
        <Card>
          <CardTitle>BuilderTrend Custom Fields</CardTitle>
          <CardDescription>
            Structured handoff fields for copy/paste (Prompt 3 will polish this UI). Values are null
            when not established in the transcript.
          </CardDescription>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {Object.entries(bt as Record<string, unknown>).map(([key, value]) => (
              <div key={key} className="rounded-md border border-[var(--acton-border)] p-3">
                <dt className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                  {key}
                </dt>
                <dd className="mt-1 text-sm text-[var(--acton-navy)]">
                  {value == null || value === ""
                    ? "Not established"
                    : Array.isArray(value)
                      ? value.join(", ") || "Not established"
                      : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-[var(--acton-muted)]">
            BuilderTrend API integration is not available — this is a structured handoff only.
          </p>
          <Link href="/pem-neats" className={cn(buttonVariants({ variant: "ghost" }), "mt-2")}>
            Back to library
          </Link>
        </Card>
      )}
    </div>
  );
}

function Section({ label, body }: { label: string; body: string | null | undefined }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 text-[var(--acton-muted)]">{body?.trim() ? body : "Not established"}</p>
    </div>
  );
}
