"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function GenerationFailedCard({
  errorMessage,
  retrying,
  onRetry,
}: {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardTitle className="text-red-900">Generation Failed</CardTitle>
      <p className="mt-2 text-sm text-red-800">
        {errorMessage ??
          "Baxter couldn't complete the analysis. Your original transcript was preserved."}
      </p>
      <p className="mt-1 text-sm text-red-700">
        You can retry generation without re-pasting the transcript.
      </p>
      <Button
        type="button"
        variant="primary"
        className={cn("mt-4")}
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Retrying…" : "Retry Generation"}
      </Button>
    </Card>
  );
}

export function GeneratingCard({ label = "Analyzing Partnership Evaluation Meeting…" }: { label?: string }) {
  return (
    <Card className="border-[var(--acton-yellow)] bg-[var(--acton-gray-50)]">
      <CardTitle>{label}</CardTitle>
      <p className="mt-2 text-sm text-[var(--acton-muted)]">
        Extracting customer intelligence and evaluating the Acton sales process. This may take a
        minute or two.
      </p>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--acton-border)]">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--acton-yellow)]" />
      </div>
    </Card>
  );
}
