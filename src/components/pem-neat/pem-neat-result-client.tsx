"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { BuildertrendFieldsPanel } from "@/components/pem-neat/buildertrend-fields-panel";
import { ConfirmDialog } from "@/components/pem-neat/confirm-dialog";
import { CopyButton } from "@/components/pem-neat/copy-button";
import {
  GeneratingCard,
  GenerationFailedCard,
} from "@/components/pem-neat/generation-status-cards";
import { NeatAssessmentPanel } from "@/components/pem-neat/neat-assessment-panel";
import { NeatFollowUpPanel } from "@/components/pem-neat/neat-follow-up-panel";
import { NeatProjectIntelligencePanel } from "@/components/pem-neat/neat-project-intelligence-panel";
import {
  NeatSalesIntelligencePanel,
} from "@/components/pem-neat/neat-sales-intelligence-panel";
import { NeatSourcePanel } from "@/components/pem-neat/neat-source-panel";
import {
  formatGeneratedAt,
  formatMeetingDate,
  OutcomeBadge,
  QualificationBadge,
} from "@/components/pem-neat/pem-neat-formatters";
import { cn } from "@/lib/utils";
import type { PemNeatRecord } from "@/lib/pem-neat/types";
import type { BuildertrendFields, PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { buildertrendFieldsSchema } from "@/lib/pem-neat/schemas";

type Tab = "neat" | "buildertrend";

function isStructuredResult(value: unknown): value is PemNeatStructuredResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "salesIntelligence" in value &&
      "assessment" in value &&
      "followUpEmail" in value,
  );
}

function parseBuildertrendFields(
  result: PemNeatStructuredResult | null,
  fallback: PemNeatRecord["buildertrend_fields"],
): BuildertrendFields {
  const raw = result?.buildertrendFields ?? fallback;
  try {
    return buildertrendFieldsSchema.parse(raw);
  } catch {
    return buildertrendFieldsSchema.parse({});
  }
}

export function PemNeatResultClient({
  item,
  generationCount,
}: {
  item: PemNeatRecord;
  generationCount?: number | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("neat");
  const [regenerating, setRegenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = isStructuredResult(item.structured_result) ? item.structured_result : null;
  const btFields = parseBuildertrendFields(result, item.buildertrend_fields);
  const isGenerating = regenerating || retrying || item.status === "generating";
  const showFailed = item.status === "failed" && !result;

  const followUpEmailCopy = result
    ? [
        result.followUpEmail.subject ? `Subject: ${result.followUpEmail.subject}` : "Subject:",
        "",
        result.followUpEmail.body,
      ].join("\n")
    : "";

  const runGenerate = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/pem-neats/${item.id}/generate`, { method: "POST" });
    const data = (await response.json()) as { error?: { message?: string }; status?: string };
    if (!response.ok) {
      throw new Error(data.error?.message ?? "Generation failed");
    }
    router.refresh();
  }, [item.id, router]);

  async function onRegenerate() {
    setRegenerating(true);
    try {
      await runGenerate();
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  }

  async function onRetry() {
    setRetrying(true);
    try {
      await runGenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/pem-neats"
          className="text-sm font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          ← Back to library
        </Link>

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{item.prospect_name}</h1>
            <p className="text-sm text-[var(--acton-muted)]">
              Partnership Evaluation Meeting NEAT
            </p>

            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-[var(--acton-muted)]">Salesperson: </dt>
                <dd className="inline text-[var(--acton-navy)]">{item.salesperson_display_name}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--acton-muted)]">Meeting Date: </dt>
                <dd className="inline text-[var(--acton-navy)]">
                  {formatMeetingDate(item.meeting_date)}
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <span className="text-[var(--acton-muted)]">Outcome:</span>
                <OutcomeBadge outcome={item.meeting_outcome} />
                <span className="text-[var(--acton-muted)]">Qualification:</span>
                <QualificationBadge level={item.qualification} />
              </div>
              <div className="sm:col-span-2">
                <dt className="inline text-[var(--acton-muted)]">Generated: </dt>
                <dd className="inline text-[var(--acton-navy)]">
                  {formatGeneratedAt(item.generated_at)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/pem-neats" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Back
            </Link>
            <button
              type="button"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              onClick={() => setConfirmOpen(true)}
              disabled={isGenerating}
            >
              Regenerate
            </button>
            {result ? (
              <>
                <CopyButton
                  getText={() => followUpEmailCopy}
                  label="Copy Follow-Up Email"
                  copiedLabel="Copied"
                  variant="secondary"
                  size="sm"
                />
                <CopyButton
                  getText={() => result.internalOpportunityNotes.trim()}
                  label="Copy Internal Notes"
                  copiedLabel="Copied"
                  variant="secondary"
                  size="sm"
                />
              </>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-xs text-[var(--acton-muted)]">
          Standard v{item.neat_standard_version}
          {item.model_provider ? ` · Provider: ${item.model_provider}` : ""}
          {item.model_name ? ` · Model: ${item.model_name}` : ""}
          {generationCount != null && generationCount > 0
            ? ` · Generations: ${generationCount}`
            : ""}
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {isGenerating ? <GeneratingCard /> : null}

      {showFailed ? (
        <GenerationFailedCard
          errorMessage={item.generation_error}
          retrying={retrying}
          onRetry={onRetry}
        />
      ) : item.generation_error && result ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-900">Last generation attempt failed</CardTitle>
          <CardDescription className="text-amber-800">
            {item.generation_error} Showing the most recent successful result.
          </CardDescription>
        </Card>
      ) : null}

      <div role="tablist" aria-label="PEM NEAT views" className="flex gap-2 border-b border-[var(--acton-border)]">
        {(
          [
            { id: "neat" as const, label: "NEAT" },
            { id: "buildertrend" as const, label: "BuilderTrend Custom Fields" },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-semibold",
              tab === id
                ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "neat" ? (
        <div role="tabpanel" id="panel-neat" aria-labelledby="tab-neat" className="space-y-6">
          {!result ? (
            <Card>
              <CardTitle>NEAT not available yet</CardTitle>
              <CardDescription>
                {item.status === "failed"
                  ? "Generation did not produce structured analysis. Retry above."
                  : "Structured analysis has not been saved for this record."}
              </CardDescription>
            </Card>
          ) : (
            <>
              <NeatSalesIntelligencePanel sales={result.salesIntelligence} />
              <NeatAssessmentPanel
                assessment={result.assessment}
                qualification={result.salesIntelligence.qualification}
              />
              <NeatFollowUpPanel followUpEmail={result.followUpEmail} />
              <NeatProjectIntelligencePanel
                projectIntelligence={result.projectIntelligence}
                productionNotes={result.productionNotes}
                internalOpportunityNotes={result.internalOpportunityNotes}
              />
              <NeatSourcePanel transcript={item.transcript} />
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="panel-buildertrend" aria-labelledby="tab-buildertrend">
          <BuildertrendFieldsPanel fields={btFields} />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Regenerate PEM NEAT?"
        description="Baxter will re-analyze the original transcript… current successful generation remains in history."
        confirmLabel="Regenerate"
        confirming={regenerating}
        onConfirm={onRegenerate}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
