"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Circle, ClipboardList, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type AsyncRunStepStatus =
  "pending" | "running" | "complete" | "failed" | "skipped" | "planned";

export type AsyncRunStep = {
  key: string;
  label: string;
  status: AsyncRunStepStatus;
  /** Caller-supplied friendly "what happened" — never raw JSON by default. */
  detail?: ReactNode;
  error?: string | null;
};

export type AsyncRunProgressProps = {
  title: string;
  description?: ReactNode;
  steps: AsyncRunStep[];
  /** Overall run status for header iconography / failure chrome. */
  runStatus: "running" | "complete" | "failed" | "timed_out";
  /** Employee-facing failure / poll error message. */
  friendlyError?: string | null;
  isAdmin?: boolean;
  /** Admin-only expandable technical details (error codes, raw JSON, stage traces). */
  adminTechnicalDetails?: ReactNode;
  retryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
  headerAside?: ReactNode;
  /** Content between description and the step list (e.g. secondary nav links). */
  beforeSteps?: ReactNode;
  footer?: ReactNode;
  /** Shown when max poll duration elapsed. */
  onManualRefresh?: () => void;
  className?: string;
};

function StepIcon({ status }: { status: AsyncRunStepStatus }) {
  if (status === "complete" || status === "skipped") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden />;
  }
  if (status === "planned") {
    return <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />;
  }
  if (status === "running") {
    return (
      <LoaderCircle
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--acton-navy)]"
        aria-hidden
      />
    );
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acton-muted)]" aria-hidden />;
}

function statusLabel(status: AsyncRunStepStatus): string | null {
  if (status === "failed") return "Failed";
  if (status === "planned") return "Planned — not executed";
  if (status === "skipped") return "Skipped";
  if (status === "running") return "In progress";
  return null;
}

export function AsyncRunProgress({
  title,
  description,
  steps,
  runStatus,
  friendlyError,
  isAdmin = false,
  adminTechnicalDetails,
  retryAction,
  headerAside,
  beforeSteps,
  footer,
  onManualRefresh,
  className,
}: AsyncRunProgressProps) {
  const failed = runStatus === "failed";
  const timedOut = runStatus === "timed_out";
  const complete = runStatus === "complete";

  return (
    <Card className={cn(failed && "border-red-200 bg-red-50", className)}>
      <div className="flex items-start gap-3">
        {runStatus === "running" ? (
          <LoaderCircle
            className="mt-1 h-5 w-5 animate-spin text-[var(--acton-navy)]"
            aria-hidden
          />
        ) : null}
        {complete ? <CheckCircle2 className="mt-1 h-5 w-5 text-green-700" aria-hidden /> : null}
        {failed || timedOut ? <XCircle className="mt-1 h-5 w-5 text-red-700" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className={failed ? "text-red-900" : undefined}>{title}</CardTitle>
            {headerAside}
          </div>
          {description ? (
            <CardDescription className={cn("mt-2", failed && "text-red-800")}>
              {description}
            </CardDescription>
          ) : null}
        </div>
      </div>

      {beforeSteps ? <div className="mt-4">{beforeSteps}</div> : null}

      {timedOut ? (
        <div
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">This is taking longer than expected</p>
          <p className="mt-1">
            Automatic status checks paused so we do not poll forever. The work may still be running
            in the background — refresh to check again.
          </p>
          {onManualRefresh ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={onManualRefresh}
            >
              Refresh status
            </Button>
          ) : null}
        </div>
      ) : null}

      <ol className="mt-6 space-y-3">
        {steps.map((step) => {
          const active = step.status === "running";
          const done = step.status === "complete" || step.status === "skipped";
          const stepFailed = step.status === "failed";
          const muted = step.status === "pending";
          const labelExtra = statusLabel(step.status);
          return (
            <li
              key={step.key}
              className={cn(
                "flex gap-3 rounded-md border px-3 py-2",
                active && "border-[var(--acton-yellow)] bg-[var(--acton-yellow)]/20",
                done && "border-[var(--acton-border)] bg-[var(--acton-gray-50)]",
                stepFailed && "border-red-200 bg-white/70",
                muted && "border-[var(--acton-border)]",
                step.status === "planned" &&
                  "border-[var(--acton-border)] bg-[var(--acton-gray-50)]",
              )}
            >
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    muted ? "text-[var(--acton-muted)]" : "text-[var(--acton-navy)]",
                    stepFailed && "text-red-800",
                  )}
                >
                  {step.label}
                  {labelExtra && (stepFailed || step.status === "planned")
                    ? ` — ${labelExtra}`
                    : ""}
                </p>
                {step.detail ? (
                  <div className="mt-1 text-xs text-[var(--acton-muted)]">{step.detail}</div>
                ) : null}
                {step.error ? (
                  <p className="mt-1 text-xs text-red-700" role="alert">
                    {step.error}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {friendlyError ? (
        <p className="mt-4 text-sm text-red-800" role="alert">
          {friendlyError}
        </p>
      ) : null}

      {isAdmin && adminTechnicalDetails ? (
        <details className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-xs text-red-900">
          <summary className="cursor-pointer font-semibold">Technical details (admin)</summary>
          <div className="mt-2 space-y-2">{adminTechnicalDetails}</div>
        </details>
      ) : null}

      {retryAction ? (
        <div className="mt-4">
          <Button
            type="button"
            variant={failed ? "primary" : "accent"}
            onClick={retryAction.onClick}
            disabled={retryAction.disabled || retryAction.loading}
          >
            {retryAction.loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            {retryAction.loading ? "Retrying…" : retryAction.label}
          </Button>
        </div>
      ) : null}

      {footer ? <div className="mt-4">{footer}</div> : null}
    </Card>
  );
}
