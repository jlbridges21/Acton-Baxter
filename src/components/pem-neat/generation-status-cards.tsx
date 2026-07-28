"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROGRESS_STEPS = [
  { key: "queued", label: "Reading transcript" },
  { key: "extracting_facts", label: "Extracting customer/project facts" },
  { key: "evaluating_sales", label: "Evaluating the sales process" },
  { key: "generating_handoff", label: "Preparing follow-up and BuilderTrend handoff" },
  { key: "quality_review", label: "Reviewing accuracy" },
] as const;

function stepState(
  stage: string | null | undefined,
  stepKey: string,
): "done" | "active" | "pending" {
  const order = PROGRESS_STEPS.map((s) => s.key);
  const current = stage && order.includes(stage as (typeof order)[number]) ? stage : "queued";
  const currentIdx = order.indexOf(current as (typeof order)[number]);
  const stepIdx = order.indexOf(stepKey as (typeof order)[number]);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

export function GenerationFailedCard({
  errorMessage,
  retrying,
  onRetry,
  adminDetails,
}: {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void;
  adminDetails?: {
    failedStage?: string | null;
    errorCode?: string | null;
    modelName?: string | null;
    stages?: Array<{ name?: unknown; status?: unknown }>;
  } | null;
}) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardTitle className="text-red-900">Unable to complete PEM analysis</CardTitle>
      <p className="mt-2 text-sm text-red-800">
        {errorMessage ??
          "Baxter couldn't safely finish this NEAT. Your transcript is saved and can be retried."}
      </p>
      <p className="mt-1 text-sm text-red-700">
        You can retry generation without re-pasting the transcript.
      </p>
      {adminDetails?.errorCode ? (
        <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-xs text-red-900">
          <p className="font-semibold">Admin diagnostics</p>
          <p className="mt-1">Error: {adminDetails.errorCode}</p>
          {adminDetails.failedStage ? (
            <p>Failed during: {String(adminDetails.failedStage)}</p>
          ) : null}
          {adminDetails.modelName ? <p>Model: {adminDetails.modelName}</p> : null}
          {adminDetails.stages?.length ? (
            <ul className="mt-2 space-y-0.5">
              {adminDetails.stages.map((s, i) => (
                <li key={`${String(s.name)}-${i}`}>
                  {String(s.name)}: {String(s.status)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="primary"
        className={cn("mt-4")}
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </Card>
  );
}

export function GeneratingCard({
  label = "Analyzing Partnership Evaluation Meeting…",
  generationStage,
}: {
  label?: string;
  generationStage?: string | null;
}) {
  return (
    <Card className="border-[var(--acton-yellow)] bg-[var(--acton-gray-50)]">
      <CardTitle>{label}</CardTitle>
      <p className="mt-2 text-sm text-[var(--acton-muted)]">
        Baxter is carefully analyzing this PEM. High-quality analysis can take several minutes — you
        can leave this page and return later.
      </p>
      <ol className="mt-4 space-y-2 text-sm">
        {PROGRESS_STEPS.map((step) => {
          const state = stepState(generationStage, step.key);
          return (
            <li key={step.key} className="flex items-start gap-2">
              <span className="mt-0.5 w-4 shrink-0 font-semibold text-[var(--acton-navy)]">
                {state === "done" ? "✓" : state === "active" ? "●" : "○"}
              </span>
              <span
                className={
                  state === "pending" ? "text-[var(--acton-muted)]" : "text-[var(--acton-navy)]"
                }
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
