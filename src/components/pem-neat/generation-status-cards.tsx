"use client";

import { AsyncRunProgress, type AsyncRunStep } from "@/components/ui/async-run-progress";

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
): AsyncRunStep["status"] {
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
    if (stepIdx < failedIdx) return "complete";
    if (stepIdx > failedIdx) return "pending";
  }
  if (stepIdx < currentIdx) return "complete";
  if (stepIdx === currentIdx) return "running";
  return "pending";
}

export function buildPemNeatProgressSteps(
  generationStage?: string | null,
  failedStage?: string | null,
): AsyncRunStep[] {
  return PROGRESS_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    status: stepState(generationStage, step.key, failedStage),
  }));
}

export function GenerationFailedCard({
  errorMessage,
  retrying,
  onRetry,
  adminDetails,
  generationStage,
  isAdmin = false,
  isTimedOut = false,
  onManualRefresh,
}: {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void;
  generationStage?: string | null;
  isAdmin?: boolean;
  isTimedOut?: boolean;
  onManualRefresh?: () => void;
  adminDetails?: {
    failedStage?: string | null;
    errorCode?: string | null;
    modelName?: string | null;
    stages?: Array<{ name?: unknown; status?: unknown }>;
    validationIssues?: string[];
  } | null;
}) {
  const showAdmin = Boolean(isAdmin && adminDetails);

  return (
    <AsyncRunProgress
      className="border-red-200 bg-red-50"
      title="Unable to complete PEM analysis"
      description={
        errorMessage ??
        "Baxter couldn't safely finish this NEAT. Your transcript is saved and can be retried."
      }
      steps={buildPemNeatProgressSteps(
        generationStage ?? adminDetails?.failedStage,
        adminDetails?.failedStage,
      )}
      runStatus={isTimedOut ? "timed_out" : "failed"}
      friendlyError={null}
      isAdmin={showAdmin}
      adminTechnicalDetails={
        showAdmin ? (
          <div className="space-y-2">
            {adminDetails?.errorCode ? <p>Error: {adminDetails.errorCode}</p> : null}
            {adminDetails?.failedStage ? (
              <p>Failed during: {String(adminDetails.failedStage)}</p>
            ) : null}
            {adminDetails?.modelName ? <p>Model: {adminDetails.modelName}</p> : null}
            {adminDetails?.validationIssues?.length ? (
              <div>
                <p className="font-semibold">Validation</p>
                <ul className="mt-1 space-y-0.5">
                  {adminDetails.validationIssues.map((issue, i) => (
                    <li key={`${issue}-${i}`}>• {issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {adminDetails?.stages?.length ? (
              <ul className="space-y-0.5">
                {adminDetails.stages.map((s, i) => (
                  <li key={`${String(s.name)}-${i}`}>
                    {String(s.name)}: {String(s.status)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null
      }
      retryAction={{
        label: adminDetails?.failedStage === "assessment" ? "Retry Assessment" : "Retry Analysis",
        onClick: onRetry,
        loading: retrying,
      }}
      onManualRefresh={onManualRefresh}
    />
  );
}

export function GeneratingCard({
  label = "Analyzing Partnership Evaluation Meeting…",
  generationStage,
  isTimedOut = false,
  onManualRefresh,
}: {
  label?: string;
  generationStage?: string | null;
  isTimedOut?: boolean;
  onManualRefresh?: () => void;
}) {
  return (
    <AsyncRunProgress
      className="border-[var(--acton-yellow)] bg-[var(--acton-gray-50)]"
      title={label}
      description="Baxter is carefully analyzing this PEM. High-quality analysis can take several minutes — you can leave this page and return later."
      steps={buildPemNeatProgressSteps(generationStage)}
      runStatus={isTimedOut ? "timed_out" : "running"}
      onManualRefresh={onManualRefresh}
    />
  );
}
