"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import {
  buildSurveyAnalytics,
  exportQuestions,
  formatAnswer,
  respondentLabel,
  type OptionTally,
  type QuestionSummary,
} from "@/lib/surveys/analytics";
import {
  SURVEY_QUESTION_TYPE_LABELS,
  activeQuestions,
  publicSurveyUrl,
  type SurveyDetail,
  type SurveyResponse,
} from "@/lib/surveys/types";
import { cn } from "@/lib/utils";
import { surveyFetch } from "./survey-api";
import { SurveyToast, useSurveyToast } from "./survey-toast";

function when(iso: string) {
  return format(parseISO(iso), "MMM d, yyyy h:mm a");
}

export function SurveyResultsClient({
  survey,
  initialResponses,
  canEdit,
}: {
  survey: SurveyDetail;
  initialResponses: SurveyResponse[];
  canEdit: boolean;
}) {
  const toast = useSurveyToast();
  const [responses, setResponses] = useState(initialResponses);
  const [tab, setTab] = useState<"summary" | "individual">("summary");
  const analytics = useMemo(() => buildSurveyAnalytics(survey, responses), [survey, responses]);
  const hasQuestions = activeQuestions(survey.questions).length > 0;

  async function copyLink() {
    const ok = await copyText(publicSurveyUrl(window.location.origin, survey.publicToken));
    toast.show(ok ? "Link copied" : "Couldn't copy the link");
  }

  return (
    <div className="space-y-6">
      <Link
        href="/surveys"
        className="inline-flex items-center gap-1 text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
      >
        <ArrowLeft className="h-4 w-4" /> Surveys
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">{survey.title}</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {responses.length} response{responses.length === 1 ? "" : "s"}
            {survey.identityMode === "anonymous" ? " · Anonymous" : ""}
            {survey.createdByName ? ` · Created by ${survey.createdByName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/surveys/${survey.id}/export-pdf`}
            className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
          >
            Download PDF
          </a>
          <a
            href={`/api/surveys/${survey.id}/export-xlsx`}
            className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
          >
            Download Excel
          </a>
          {hasQuestions ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
              Copy link
            </Button>
          ) : null}
          {canEdit ? (
            <Link
              href={`/surveys/${survey.id}/edit`}
              className="inline-flex h-8 items-center rounded-md bg-[var(--acton-navy)] px-3 text-xs font-semibold text-white"
            >
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Results view"
        className="flex gap-1 border-b border-[var(--acton-border)]"
      >
        {(["summary", "individual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-semibold",
              tab === t
                ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-navy)]",
            )}
          >
            {t === "summary" ? "Summary" : "Individual"}
          </button>
        ))}
      </div>

      {responses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--acton-border)] px-4 py-16 text-center">
          <p className="text-sm font-semibold text-[var(--acton-navy)]">No responses yet</p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {hasQuestions
              ? "Share the link to start collecting responses."
              : "Add questions to this survey before sharing it."}
          </p>
        </div>
      ) : tab === "summary" ? (
        <div className="space-y-4" role="tabpanel">
          {analytics.questions.map((s) => (
            <QuestionResult key={s.question.id} summary={s} />
          ))}
          {analytics.removedQuestions.length > 0 ? (
            <section className="space-y-4 pt-4">
              <h2 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Removed questions
              </h2>
              {analytics.removedQuestions.map((s) => (
                <QuestionResult key={s.question.id} summary={s} />
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <IndividualResponses
          survey={survey}
          responses={responses}
          canEdit={canEdit}
          onDeleted={(id) => {
            setResponses((prev) => prev.filter((r) => r.id !== id));
            toast.show("Response deleted");
          }}
        />
      )}

      <SurveyToast message={toast.message} />
    </div>
  );
}

function Bars({
  rows,
  testId,
}: {
  rows: Array<Pick<OptionTally, "label" | "count" | "percent">>;
  testId?: string;
}) {
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate text-[var(--acton-navy)]" title={row.label}>
            {row.label}
          </span>
          <span className="h-3 overflow-hidden rounded-full bg-[var(--acton-gray-50)]">
            <span
              className="block h-full rounded-full bg-[var(--acton-navy)]"
              style={{ width: `${Math.min(100, row.percent)}%` }}
            />
          </span>
          <span className="w-24 text-right text-[var(--acton-muted)] tabular-nums">
            {row.count} · {row.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star
          key={v}
          aria-hidden
          className={cn(
            "h-4 w-4",
            v <= value
              ? "fill-[var(--acton-yellow)] text-[var(--acton-yellow)]"
              : "text-[var(--acton-border)]",
          )}
        />
      ))}
    </span>
  );
}

function QuestionResult({ summary }: { summary: QuestionSummary }) {
  const q = summary.question;
  return (
    <Card data-testid={`result-${q.id}`}>
      <h3 className="text-base font-semibold text-[var(--acton-navy)]">{q.prompt}</h3>
      <p className="mt-0.5 mb-4 text-xs text-[var(--acton-muted)]">
        {SURVEY_QUESTION_TYPE_LABELS[q.type]} · {summary.answeredCount} answered
      </p>

      {summary.kind === "star_rating" ? (
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span
              className="text-3xl font-semibold text-[var(--acton-navy)]"
              data-testid="star-average"
            >
              {summary.average === null ? "—" : summary.average.toFixed(2)}
            </span>
            <span className="text-sm text-[var(--acton-muted)]">/ 5 average</span>
          </div>
          <Bars
            rows={[...summary.distribution].reverse().map((d) => ({
              label: `${d.value} star${d.value === 1 ? "" : "s"}`,
              count: d.count,
              percent: d.percent,
            }))}
          />
          {summary.ratings.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-[var(--acton-navy)]">
                Show individual ratings ({summary.ratings.length})
              </summary>
              <ul className="mt-2 divide-y divide-[var(--acton-border)]">
                {summary.ratings.map((r) => (
                  <li key={r.responseId} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-[var(--acton-navy)]">{r.respondent ?? "Anonymous"}</span>
                    <span className="flex items-center gap-3">
                      <Stars value={r.value} />
                      <span className="text-xs text-[var(--acton-muted)]">
                        {when(r.submittedAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {summary.kind === "text" ? (
        summary.answers.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No answers yet.</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
            {summary.answers.map((a) => (
              <li key={a.responseId} className="rounded-md bg-[var(--acton-gray-50)] p-3">
                <p className="text-sm whitespace-pre-wrap text-[var(--acton-navy)]">{a.text}</p>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {a.respondent ? `${a.respondent} · ` : ""}
                  {when(a.submittedAt)}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {summary.kind === "dropdown" ? (
        <Bars
          testId="dropdown-bars"
          rows={[
            ...summary.options,
            ...(summary.noAnswer ? [{ label: "No answer", ...summary.noAnswer }] : []),
          ]}
        />
      ) : null}

      {summary.kind === "multi_select" ? (
        <div className="space-y-2">
          <Bars rows={summary.options} />
          <p className="text-xs text-[var(--acton-muted)]">
            Percent of the {summary.answeredCount} people who answered. Totals can exceed 100%
            because people can pick more than one.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function IndividualResponses({
  survey,
  responses,
  canEdit,
  onDeleted,
}: {
  survey: SurveyDetail;
  responses: SurveyResponse[];
  canEdit: boolean;
  onDeleted: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeIndex = Math.min(index, responses.length - 1);
  const response = responses[safeIndex]!;
  const questions = useMemo(
    () => exportQuestions(survey.questions, responses),
    [survey.questions, responses],
  );
  const respondent = respondentLabel(response, survey.identityMode);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await surveyFetch(`/api/surveys/${survey.id}/responses/${response.id}`, { method: "DELETE" });
      setConfirming(false);
      setIndex((i) => Math.max(0, Math.min(i, responses.length - 2)));
      onDeleted(response.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the response.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" role="tabpanel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={safeIndex === 0}
            onClick={() => setIndex(safeIndex - 1)}
            aria-label="Previous response"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-[var(--acton-navy)]" data-testid="response-position">
            Response {safeIndex + 1} of {responses.length}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={safeIndex >= responses.length - 1}
            onClick={() => setIndex(safeIndex + 1)}
            aria-label="Next response"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {canEdit ? (
          <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
            Delete response
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <Card>
        <p className="text-xs text-[var(--acton-muted)]">
          Submitted {when(response.submittedAt)}
          {respondent ? ` · ${respondent}` : ""}
        </p>
        <dl className="mt-4 space-y-4">
          {questions.map((q) => {
            const value = formatAnswer(
              q,
              response.answers.find((a) => a.questionId === q.id),
            );
            return (
              <div key={q.id}>
                <dt className="text-sm font-semibold text-[var(--acton-navy)]">
                  {q.prompt}
                  {q.archivedAt ? (
                    <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                      (removed)
                    </span>
                  ) : null}
                </dt>
                <dd className="mt-1 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
                  {q.type === "star_rating" && value ? (
                    <Stars value={Number(value)} />
                  ) : (
                    value || <span className="text-[var(--acton-muted)]">No answer</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title="Delete this response?"
        description="It will be removed from results and exports. This can't be undone."
        confirmLabel="Delete"
        destructive
        busy={busy}
      />
    </div>
  );
}
