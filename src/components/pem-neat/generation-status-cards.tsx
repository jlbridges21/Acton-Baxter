"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROGRESS_STEPS = [
  { key: "queued", label: "Reading transcript" },
  { key: "extracting_facts", label: "Understanding customer and project" },
  { key: "building_sales_intelligence", label: "Building sales intelligence" },
  { key: "evaluating_sales", label: "Evaluating the sales process" },
  { key: "generating_handoff", label: "Preparing follow-up and BuilderTrend handoff" },
  { key: "quality_review", label: "Reviewing accuracy" },
] as const;

function mapStageToStep(stage: string | null | undefined): string {
  if (!stage) return "queued";
  if (stage === "sales_intelligence" || stage === "building_sales_intelligence") {
    return "building_sales_intelligence";
  }
  if (stage === "fact_ledger" || stage === "fact_ledger_resume" || stage === "extracting_facts") {
    return "extracting_facts";
  }
  if (stage === "assessment" || stage === "evaluating_sales") return "evaluating_sales";
  if (stage === "email" || stage === "handoff" || stage === "generating_handoff") {
    return "generating_handoff";
  }
  if (stage === "quality_review" || stage === "correction" || stage === "quality_gate") {
    return "quality_review";
  }
  if (PROGRESS_STEPS.some((s) => s.key === stage)) return stage;
  return "queued";
}

function stepState(
  stage: string | null | undefined,
  stepKey: string,
  failedStage?: string | null,
): "done" | "active" | "pending" | "failed" {
  const order = PROGRESS_STEPS.map((s) => s.key);
  const failedStep = failedStage ? mapStageToStep(failedStage) : null;
  if (failedStep === stepKey) return "failed";

  const current = mapStageToStep(stage);
  const currentIdx = order.indexOf(current as (typeof order)[number]);
  const stepIdx = order.indexOf(stepKey as (typeof order)[number]);
  if (stepIdx < 0) return "pending";
  if (currentIdx < 0) return "pending";
  if (failedStep) {
    const failedIdx = order.indexOf(failedStep as (typeof order)[number]);
    if (stepIdx < failedIdx) return "done";
    if (stepIdx > failedIdx) return "pending";
  }
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

function ProgressList({
  generationStage,
  failedStage,
}: {
  generationStage?: string | null;
  failedStage?: string | null;
}) {
  return (
    <ol className="mt-4 space-y-2 text-sm">
      {PROGRESS_STEPS.map((step) => {
        const state = stepState(generationStage, step.key, failedStage);
        return (
          <li key={step.key} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 w-4 shrink-0 font-semibold",
                state === "failed" ? "text-red-700" : "text-[var(--acton-navy)]",
              )}
            >
              {state === "done" ? "✓" : state === "failed" ? "✗" : state === "active" ? "●" : "○"}
            </span>
            <span
              className={
                state === "pending"
                  ? "text-[var(--acton-muted)]"
                  : state === "failed"
                    ? "font-medium text-red-800"
                    : "text-[var(--acton-navy)]"
              }
            >
              {step.label}
              {state === "failed"
                ? " — Failed"
                : state === "pending" && failedStage
                  ? " — Waiting"
                  : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function GenerationFailedCard({
  errorMessage,
  retrying,
  onRetry,
  adminDetails,
  generationStage,
}: {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void;
  generationStage?: string | null;
  adminDetails?: {
    failedStage?: string | null;
    errorCode?: string | null;
    modelName?: string | null;
    stages?: Array<{ name?: unknown; status?: unknown }>;
    validationIssues?: string[];
  } | null;
}) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardTitle className="text-red-900">Unable to complete PEM analysis</CardTitle>
      <p className="mt-2 text-sm text-red-800">
        {errorMessage ??
          "Baxter couldn't safely finish this NEAT. Your transcript is saved and can be retried."}
      </p>
      <ProgressList
        generationStage={generationStage ?? adminDetails?.failedStage}
        failedStage={adminDetails?.failedStage}
      />
      {adminDetails?.errorCode ? (
        <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-xs text-red-900">
          <p className="font-semibold">Admin diagnostics</p>
          <p className="mt-1">Error: {adminDetails.errorCode}</p>
          {adminDetails.failedStage ? (
            <p>Failed during: {String(adminDetails.failedStage)}</p>
          ) : null}
          {adminDetails.modelName ? <p>Model: {adminDetails.modelName}</p> : null}
          {adminDetails.validationIssues?.length ? (
            <div className="mt-2">
              <p className="font-semibold">Validation</p>
              <ul className="mt-1 space-y-0.5">
                {adminDetails.validationIssues.map((issue, i) => (
                  <li key={`${issue}-${i}`}>• {issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
        {retrying
          ? "Retrying…"
          : adminDetails?.failedStage === "assessment"
            ? "Retry Assessment"
            : "Retry Analysis"}
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
      <ProgressList generationStage={generationStage} />
    </Card>
  );
}
