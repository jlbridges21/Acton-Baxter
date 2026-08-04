"use client";

import { useState } from "react";
import { Card, CardDescription } from "@/components/ui/card";
import type { BaxterInquiryAdminRow } from "@/lib/baxter-ai/feedback-inquiries";

/**
 * Collapsed view shows the same truncated excerpts as before.
 * Expanded view shows full question/answer text sent with the page payload
 * (bounded page size — no lazy fetch needed).
 */
export function FeedbackInquiryCard({ row }: { row: BaxterInquiryAdminRow }) {
  const [expanded, setExpanded] = useState(false);
  const question = expanded ? row.questionText : row.questionExcerpt;
  const answer = expanded ? row.answerText : row.answerExcerpt;
  const isTruncated =
    row.questionText.length > row.questionExcerpt.length ||
    row.answerText.length > row.answerExcerpt.length;
  const showToggle = expanded || isTruncated;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            row.summarizedRating === "positive"
              ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
              : row.summarizedRating === "negative"
                ? "rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
                : "rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
          }
        >
          {row.summarizedRating === "positive"
            ? "Positive"
            : row.summarizedRating === "negative"
              ? "Negative"
              : "No feedback"}
        </span>
        <span className="rounded bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-medium text-[var(--acton-navy)]">
          {row.channel === "slack" ? "Slack" : "Web"}
        </span>
        <CardDescription className="!mt-0">
          {new Date(row.createdAt).toLocaleString()} · Asked by {row.askerLabel}
          {row.department ? ` · ${row.department}` : " · Unassigned"}
        </CardDescription>
      </div>
      {question ? (
        <p
          className={`mt-2 text-sm font-semibold text-[var(--acton-navy)] ${
            expanded ? "whitespace-pre-wrap" : ""
          }`}
        >
          Q: {question}
        </p>
      ) : null}
      {answer ? (
        <p
          className={`mt-1 text-sm text-[var(--acton-muted)] ${expanded ? "whitespace-pre-wrap" : ""}`}
        >
          A: {answer}
        </p>
      ) : null}
      {showToggle ? (
        <button
          type="button"
          className="mt-1 text-sm font-medium text-[var(--acton-navy)] underline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "See less" : "See more"}
        </button>
      ) : null}
      {row.feedbackEntries.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--acton-muted)]">No feedback</p>
      ) : (
        <div className="mt-2 space-y-2">
          {row.feedbackEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-soft)]/40 px-3 py-2 text-sm"
            >
              <p className="font-medium text-[var(--acton-navy)]">
                {entry.rating === "up" ? "👍 Positive" : "👎 Negative"} · {entry.commenterLabel}
                <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </p>
              {entry.comment ? (
                <p className="mt-1 whitespace-pre-wrap text-[var(--acton-navy)]">{entry.comment}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--acton-muted)]">
        Mode: {row.answerMode ?? "—"} · Sources: {row.sourceCount}
        {row.errorCode ? ` · Error: ${row.errorCode}` : ""}
      </p>
    </Card>
  );
}
