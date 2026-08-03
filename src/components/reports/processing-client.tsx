"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncRunProgress, type AsyncRunStep } from "@/components/ui/async-run-progress";
import { useAsyncRunStatus } from "@/hooks/use-async-run-status";
import { RESEARCH_STAGES } from "@/lib/research/constants";

type StatusPayload = {
  status: string;
  stageIndex: number;
  stageLabel: string;
  stages?: string[];
  errorMessage?: string | null;
};

function mapResearchSteps(payload: StatusPayload | null): AsyncRunStep[] {
  const stages = payload?.stages ?? [...RESEARCH_STAGES];
  const failed = payload?.status === "failed";
  const complete = payload?.status === "complete";
  const stageIndex = payload?.stageIndex ?? 0;

  return stages.map((stage, index) => {
    let status: AsyncRunStep["status"] = "pending";
    if (failed && index === stageIndex) status = "failed";
    else if (complete || index < stageIndex) status = "complete";
    else if (index === stageIndex && !failed) status = "running";
    return { key: `${index}-${stage}`, label: stage, status };
  });
}

export function ProcessingClient({
  reportId,
  isAdmin = false,
}: {
  reportId: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const runStarted = useRef(false);

  const onData = useCallback(
    (payload: StatusPayload) => {
      if (payload.status === "queued" && !runStarted.current) {
        runStarted.current = true;
        // Do not await completion — research continues if the user leaves this page.
        void fetch(`/api/reports/${reportId}/run`, { method: "POST" });
      }
      if (payload.status === "complete") {
        router.replace(`/reports/${reportId}`);
      }
    },
    [reportId, router],
  );

  const { data, error, isTimedOut, refresh, resumePolling } = useAsyncRunStatus<StatusPayload>({
    url: `/api/reports/${reportId}/status`,
    isTerminal: (p) => p.status === "complete" || p.status === "failed",
    onData,
  });

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    runStarted.current = false;
    try {
      const response = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" });
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

  const failed = data?.status === "failed";
  const runStatus = isTimedOut
    ? "timed_out"
    : failed
      ? "failed"
      : data?.status === "complete"
        ? "complete"
        : "running";

  const friendlyError =
    retryError ??
    (failed
      ? (data?.errorMessage ?? "The research pipeline could not finish. You can retry this report.")
      : error);

  return (
    <AsyncRunProgress
      className="mx-auto max-w-2xl"
      title={failed ? "Research failed" : "Researching property"}
      description={
        failed
          ? "The research pipeline could not finish. You can retry this report."
          : "Gathering parcel, property, jurisdiction, and hazard information. You can leave this page — research continues in the background. Return from Dashboard or Report History when it finishes."
      }
      steps={mapResearchSteps(data)}
      runStatus={runStatus}
      friendlyError={friendlyError}
      isAdmin={isAdmin}
      adminTechnicalDetails={
        failed || error ? (
          <pre className="overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(
              {
                status: data?.status,
                stageIndex: data?.stageIndex,
                stageLabel: data?.stageLabel,
                errorMessage: data?.errorMessage ?? error,
              },
              null,
              2,
            )}
          </pre>
        ) : null
      }
      retryAction={
        failed
          ? {
              label: "Retry research",
              onClick: () => void handleRetry(),
              loading: retrying,
            }
          : undefined
      }
      onManualRefresh={() => void refresh()}
      beforeSteps={
        !failed ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            >
              Go to dashboard
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            >
              Report history
            </Link>
            <Link
              href="/reports/new"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            >
              Start another report
            </Link>
          </div>
        ) : null
      }
    />
  );
}
