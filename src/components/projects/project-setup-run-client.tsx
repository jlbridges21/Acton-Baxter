"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AsyncRunProgress, type AsyncRunStep } from "@/components/ui/async-run-progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useAsyncRunStatus } from "@/hooks/use-async-run-status";
import { formatProjectSetupStepStatus } from "@/lib/project-setup/step-status";
import { summarizeProjectSetupStepOutput } from "@/lib/project-setup/step-output-summary";
import {
  MANUAL_RESOLVE_FIELDS,
  type ManualResolveField,
} from "@/lib/project-setup/manual-resolve-fields";
import type { ProjectSetupStepKey } from "@/lib/project-setup/types";

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

function resolveFieldsForStep(stepKey: string): ManualResolveField[] {
  if (stepKey in MANUAL_RESOLVE_FIELDS) {
    return MANUAL_RESOLVE_FIELDS[stepKey as ProjectSetupStepKey];
  }
  return [];
}

function AdminManualResolveCard({
  runId,
  step,
  onResolved,
}: {
  runId: string;
  step: StepRow;
  onResolved: () => void;
}) {
  const fields = resolveFieldsForStep(step.stepKey);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/setup/${runId}/resolve-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id, note, outputs }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Could not resolve step");
      }
      setOpen(false);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve step");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3">
      <p className="text-sm font-semibold text-[var(--acton-navy)]">{step.title}</p>
      {step.error ? <p className="mt-1 text-xs text-[var(--acton-danger)]">{step.error}</p> : null}
      {!open ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          onClick={() => setOpen(true)}
        >
          Mark step as manually resolved
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-[var(--acton-muted)]">
            Confirm what you verified in Drive/Slack/Sheets.{" "}
            {fields.some((f) => f.required)
              ? "Supply the real output values later steps need — do not leave them blank."
              : "This step has no downstream dependents; a note is enough."}
          </p>
          {fields.map((field) => (
            <label key={field.key} className="block space-y-1 text-sm">
              <span className="font-medium text-[var(--acton-navy)]">
                {field.label}
                {field.required ? " *" : " (optional)"}
              </span>
              <input
                className="w-full rounded border border-[var(--acton-border)] bg-white px-2 py-1.5 text-sm"
                value={outputs[field.key] ?? ""}
                onChange={(e) => setOutputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.hint}
              />
            </label>
          ))}
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Verification note *</span>
            <textarea
              className="w-full rounded border border-[var(--acton-border)] bg-white px-2 py-1.5 text-sm"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. confirmed folder exists in Drive, manually removed duplicates, folder id is …"
            />
          </label>
          {error ? <p className="text-xs text-[var(--acton-danger)]">{error}</p> : null}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={submitting}
              className="rounded bg-[var(--acton-navy)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => void submit()}
            >
              {submitting ? "Saving…" : "Resolve and resume"}
            </button>
            <button
              type="button"
              className="text-sm text-[var(--acton-muted)] underline-offset-2 hover:underline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
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
  const failedSteps = steps.filter((s) => s.status === "failed");

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

      {failed && isAdmin && failedSteps.length > 0 ? (
        <Card>
          <CardTitle>Admin: manual step resolution</CardTitle>
          <CardDescription className="mt-2">
            Use when the side effect already exists (or was cleaned up by hand) and retry would be
            wrong. Required outputs are enforced for steps later steps depend on.
          </CardDescription>
          <div className="mt-4 space-y-3">
            {failedSteps.map((step) => (
              <AdminManualResolveCard
                key={step.id}
                runId={runId}
                step={step}
                onResolved={() => {
                  kicked.current = false;
                  resumePolling();
                  void refresh();
                }}
              />
            ))}
          </div>
        </Card>
      ) : null}

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
