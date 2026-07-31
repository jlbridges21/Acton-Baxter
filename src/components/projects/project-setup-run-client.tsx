"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  contactSnapshot: { name?: string | null };
};

export function ProjectSetupRunClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let kicked = false;

    async function kick() {
      if (kicked) return;
      kicked = true;
      void fetch(`/api/projects/setup/${runId}/run`, { method: "POST" });
    }

    async function poll() {
      try {
        const response = await fetch(`/api/projects/setup/${runId}`);
        const payload = (await response.json()) as {
          run?: RunRow;
          steps?: StepRow[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Unable to load run");
        }
        if (cancelled) return;
        setRun(payload.run ?? null);
        setSteps(payload.steps ?? []);
        setError(payload.run?.error ?? null);

        if (
          payload.run &&
          (payload.run.status === "confirmed" || payload.run.status === "failed")
        ) {
          void kick();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load run");
        }
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/setup/${runId}/run`, { method: "POST" });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Retry failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  const failed = run?.status === "failed";
  const complete = run?.status === "complete";
  const plannedSteps = steps.filter(
    (s) => s.outputJson?.mode === "dry_run" || s.outputJson?.planned,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          {!failed && !complete ? (
            <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-[var(--acton-navy)]" />
          ) : null}
          {complete ? <CheckCircle2 className="mt-1 h-5 w-5 text-green-700" /> : null}
          {failed ? <XCircle className="mt-1 h-5 w-5 text-red-700" /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>
                {failed
                  ? "Project setup failed"
                  : complete
                    ? "Dry-run complete"
                    : "Running project setup"}
              </CardTitle>
              {run?.dryRun ? <Badge tone="amber">Dry-run</Badge> : null}
            </div>
            <CardDescription className="mt-2">
              {complete
                ? "No external systems were touched. The recorded plan below is what Prompts 2 and 3 will execute for real."
                : failed
                  ? "A step failed. You can retry — completed steps will not re-run."
                  : "Allocating the project number and recording the dry-run plan for each later step."}
            </CardDescription>
            {run ? (
              <p className="mt-2 text-sm text-[var(--acton-muted)]">
                {run.contactSnapshot?.name ?? "Customer"} · {run.projectNumber ?? "—"} ·{" "}
                {run.salesRep ?? "—"}
              </p>
            ) : null}
          </div>
        </div>

        <ol className="mt-6 space-y-3">
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex gap-3 rounded-md border border-[var(--acton-border)] px-3 py-2",
                step.status === "running" && "bg-[var(--acton-gray-50)]",
              )}
            >
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--acton-navy)]">{step.title}</p>
                <p className="text-xs text-[var(--acton-muted)] capitalize">{step.status}</p>
                {step.error ? <p className="mt-1 text-xs text-red-700">{step.error}</p> : null}
              </div>
            </li>
          ))}
        </ol>

        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        {failed ? (
          <div className="mt-4">
            <Button onClick={() => void handleRetry()} disabled={retrying}>
              {retrying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              Retry from failed step
            </Button>
          </div>
        ) : null}

        <div className="mt-4">
          <Link
            href="/projects/setup"
            className="text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
          >
            ← Start another setup
          </Link>
        </div>
      </Card>

      {complete && plannedSteps.length > 0 ? (
        <Card>
          <CardTitle>Recorded plan</CardTitle>
          <CardDescription className="mt-2">
            Folder <strong>{run?.folderName}</strong>, charter <strong>{run?.charterName}</strong>,
            Slack <strong>#{run?.slackChannelName}</strong>
          </CardDescription>
          <div className="mt-4 space-y-3">
            {plannedSteps.map((step) => (
              <div
                key={step.id}
                className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3"
              >
                <p className="text-sm font-semibold text-[var(--acton-navy)]">{step.title}</p>
                <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-[var(--acton-muted)]">
                  {JSON.stringify(step.outputJson.planned ?? step.outputJson, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "complete" || status === "skipped") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />;
  }
  if (status === "failed") {
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />;
  }
  if (status === "running") {
    return (
      <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--acton-navy)]" />
    );
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acton-muted)]" />;
}
