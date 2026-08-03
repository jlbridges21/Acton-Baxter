"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AsyncRunProgress, type AsyncRunStep } from "@/components/ui/async-run-progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useAsyncRunStatus } from "@/hooks/use-async-run-status";
import { formatProjectSetupStepStatus } from "@/lib/project-setup/step-status";
import { summarizeProjectSetupStepOutput } from "@/lib/project-setup/step-output-summary";

type StepRow = {
  id: string;
  stepKey: string;
  title: string;
  orderIndex: number;
  status: string;
  outputJson: Record<string, unknown>;
  error: string | null;
};

type RunRow = {
  id: string;
  status: string;
  dryRun: boolean;
  projectNumber: string | null;
  folderName: string | null;
  charterName: string | null;
  slackChannelName: string | null;
  salesRep: string | null;
  error: string | null;
  initiatedBy: string | null;
  contactSnapshot: { name?: string | null };
};

type SetupStatusPayload = {
  run?: RunRow;
  steps?: StepRow[];
};

function mapStepStatus(status: string): AsyncRunStep["status"] {
  if (status === "complete") return "complete";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "skipped") return "skipped";
  if (status === "planned") return "planned";
  return "pending";
}

function StepDetail({ step }: { step: StepRow }): ReactNode {
  if (!step.outputJson || Object.keys(step.outputJson).length === 0) {
    return (
      <p className="text-xs text-[var(--acton-muted)]">
        {formatProjectSetupStepStatus(step.status)}
      </p>
    );
  }
  const summary = summarizeProjectSetupStepOutput(step.stepKey, step.outputJson);
  return (
    <div className="space-y-1">
      <p>{summary.headline}</p>
      {summary.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {summary.links.length > 0 ? (
        <ul className="space-y-0.5">
          {summary.links.map((link) => (
            <li key={link.href + link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FriendlyResultsCard({
  title,
  description,
  steps,
  isAdmin,
}: {
  title: string;
  description?: ReactNode;
  steps: StepRow[];
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription className="mt-2">{description}</CardDescription> : null}
      <div className="mt-4 space-y-3">
        {steps.map((step) => {
          const summary = summarizeProjectSetupStepOutput(step.stepKey, step.outputJson);
          return (
            <div
              key={step.id}
              className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3"
            >
              <p className="text-sm font-semibold text-[var(--acton-navy)]">{step.title}</p>
              <p className="mt-1 text-sm text-[var(--acton-muted)]">{summary.headline}</p>
              {summary.notes.map((note) => (
                <p key={note} className="mt-1 text-xs text-[var(--acton-muted)]">
                  {note}
                </p>
              ))}
              {summary.links.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {summary.links.map((link) => (
                    <li key={link.href + link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {isAdmin ? (
                <details className="mt-2 text-xs text-[var(--acton-muted)]">
                  <summary className="cursor-pointer font-semibold text-[var(--acton-navy)]">
                    Technical details (admin)
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(summary.raw, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ProjectSetupRunClient({
  runId,
  canRetry = true,
  isAdmin = false,
}: {
  runId: string;
  canRetry?: boolean;
  isAdmin?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const kicked = useRef(false);

  const onData = useCallback(
    (payload: SetupStatusPayload) => {
      if (payload.run?.status === "confirmed" && !kicked.current) {
        kicked.current = true;
        void fetch(`/api/projects/setup/${runId}/run`, { method: "POST" });
      }
    },
    [runId],
  );

  const { data, error, isTimedOut, refresh, resumePolling } = useAsyncRunStatus<SetupStatusPayload>(
    {
      url: `/api/projects/setup/${runId}`,
      isTerminal: (p) => p.run?.status === "complete" || p.run?.status === "failed",
      onData,
    },
  );

  const run = data?.run ?? null;
  const steps = data?.steps ?? [];

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    kicked.current = false;
    try {
      const response = await fetch(`/api/projects/setup/${runId}/run`, { method: "POST" });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Retry failed");
      }
      resumePolling();
      await refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  const failed = run?.status === "failed";
  const complete = run?.status === "complete";
  const runStatus = isTimedOut
    ? "timed_out"
    : failed
      ? "failed"
      : complete
        ? "complete"
        : "running";

  const progressSteps: AsyncRunStep[] = steps.map((step) => ({
    key: step.id,
    label: step.title,
    status: mapStepStatus(step.status),
    detail:
      step.status === "complete" ||
      step.status === "planned" ||
      step.status === "skipped" ||
      (step.outputJson && Object.keys(step.outputJson).length > 0) ? (
        <StepDetail step={step} />
      ) : (
        <span>{formatProjectSetupStepStatus(step.status)}</span>
      ),
    error: step.error,
  }));

  const plannedSteps = steps.filter(
    (s) => s.status === "planned" || s.outputJson?.mode === "dry_run",
  );
  const liveOutputs = steps.filter((s) => s.outputJson?.mode === "live" && s.status === "complete");

  const friendlyError =
    retryError ??
    (failed
      ? (run?.error ?? "A step failed. Retry resumes from the first incomplete step.")
      : error);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <AsyncRunProgress
        title={
          failed
            ? "Project setup failed"
            : complete
              ? run?.dryRun
                ? "Dry-run complete"
                : "Project setup complete"
              : "Running project setup"
        }
        description={
          complete
            ? run?.dryRun
              ? "No external systems were touched. Planned steps below are informational only — the project number was not reserved."
              : "Google and Slack steps finished (or were planned when a gate was off)."
            : failed
              ? "A step failed. Retry resumes from the first incomplete step — completed work is not repeated."
              : "Working through project number, Master Log, Drive folder, charter, Slack…"
        }
        headerAside={run?.dryRun ? <Badge tone="amber">Dry-run</Badge> : null}
        steps={progressSteps}
        runStatus={runStatus}
        friendlyError={friendlyError}
        isAdmin={isAdmin}
        adminTechnicalDetails={
          failed || run?.error ? (
            <div className="space-y-2">
              {run?.error ? <p>Run error: {run.error}</p> : null}
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    runStatus: run?.status,
                    steps: steps.map((s) => ({
                      key: s.stepKey,
                      status: s.status,
                      error: s.error,
                      outputJson: s.outputJson,
                    })),
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null
        }
        retryAction={
          failed && canRetry
            ? {
                label: "Retry from failed step",
                onClick: () => void handleRetry(),
                loading: retrying,
              }
            : undefined
        }
        onManualRefresh={() => void refresh()}
        footer={
          <div className="space-y-3">
            {run ? (
              <p className="text-sm text-[var(--acton-muted)]">
                {run.contactSnapshot?.name ?? "Customer"} · {run.projectNumber ?? "—"} ·{" "}
                {run.salesRep ?? "—"}
              </p>
            ) : null}
            <Link
              href="/projects/setup"
              className="text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
            >
              ← Start another setup
            </Link>
          </div>
        }
      />

      {complete && liveOutputs.length > 0 ? (
        <FriendlyResultsCard title="Live results" steps={liveOutputs} isAdmin={isAdmin} />
      ) : null}

      {complete && plannedSteps.length > 0 ? (
        <FriendlyResultsCard
          title="Recorded plan"
          description={
            <>
              Folder <strong>{run?.folderName}</strong>, charter <strong>{run?.charterName}</strong>
              , Slack <strong>#{run?.slackChannelName}</strong>
            </>
          }
          steps={plannedSteps}
          isAdmin={isAdmin}
        />
      ) : null}
    </div>
  );
}
