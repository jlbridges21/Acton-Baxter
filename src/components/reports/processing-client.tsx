"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { RESEARCH_STAGES } from "@/lib/research/constants";
import { cn } from "@/lib/utils";

type StatusPayload = {
  status: string;
  stageIndex: number;
  stageLabel: string;
  stages?: string[];
  errorMessage?: string | null;
};

export function ProcessingClient({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusPayload>({
    status: "queued",
    stageIndex: 0,
    stageLabel: RESEARCH_STAGES[0]!,
  });
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let runStarted = false;

    async function ensureRunning() {
      if (runStarted) return;
      runStarted = true;
      try {
        // Do not await completion — research continues if the user leaves this page.
        void fetch(`/api/reports/${reportId}/run`, { method: "POST" });
      } catch {
        // Status polling will surface failures.
      }
    }

    async function poll() {
      try {
        const response = await fetch(`/api/reports/${reportId}/status`);
        const payload = (await response.json()) as StatusPayload & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Unable to load status");
        }
        if (cancelled) return;
        setStatus(payload);
        setError(payload.errorMessage ?? null);

        if (payload.status === "queued") {
          void ensureRunning();
        }

        if (payload.status === "complete") {
          router.replace(`/reports/${reportId}`);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load status");
        }
      }
    }

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [reportId, router]);

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Retry failed");
      }
      setStatus({
        status: "queued",
        stageIndex: 0,
        stageLabel: RESEARCH_STAGES[0]!,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  const stages = status.stages ?? [...RESEARCH_STAGES];
  const failed = status.status === "failed";

  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex items-start gap-3">
        {!failed ? (
          <LoaderCircle className="mt-1 h-5 w-5 animate-spin text-[var(--acton-navy)]" />
        ) : null}
        <div>
          <CardTitle>{failed ? "Research failed" : "Researching property"}</CardTitle>
          <CardDescription className="mt-2">
            {failed
              ? "The research pipeline could not finish. You can retry this report."
              : "Gathering parcel, property, jurisdiction, and hazard information. You can leave this page — research continues in the background. Return from Dashboard or Report History when it finishes."}
          </CardDescription>
        </div>
      </div>

      {!failed ? (
        <div className="mt-4 flex flex-wrap gap-2">
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
      ) : null}

      <ol className="mt-6 space-y-3">
        {stages.map((stage, index) => {
          const active = index === status.stageIndex && !failed;
          const done = index < status.stageIndex || status.status === "complete";
          return (
            <li
              key={stage}
              className={cn(
                "rounded-md border px-4 py-3 text-sm",
                active
                  ? "border-[var(--acton-yellow)] bg-[var(--acton-yellow)]/20 font-semibold text-[var(--acton-navy)]"
                  : done
                    ? "border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-[var(--acton-navy)]"
                    : "border-[var(--acton-border)] text-[var(--acton-muted)]",
              )}
            >
              {stage}
            </li>
          );
        })}
      </ol>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      {failed ? (
        <div className="mt-6">
          <Button type="button" variant="accent" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Retrying..." : "Retry research"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
