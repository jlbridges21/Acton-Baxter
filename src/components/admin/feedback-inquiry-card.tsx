"use client";

import { useState } from "react";
import { Card, CardDescription } from "@/components/ui/card";
import type { BaxterInquiryAdminRow } from "@/lib/baxter-ai/feedback-inquiries";

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * Collapsed view shows the same truncated excerpts as before.
 * Expanded view shows full question/answer text sent with the page payload
 * (bounded page size — no lazy fetch needed).
 */
export function FeedbackInquiryCard({ row }: { row: BaxterInquiryAdminRow }) {
  const [expanded, setExpanded] = useState(false);

  const questionText = asText(row.questionText);
  const answerText = asText(row.answerText);
  const questionExcerpt = asText(row.questionExcerpt);
  const answerExcerpt = asText(row.answerExcerpt);
  const askerLabel = asText(row.askerLabel).trim() || "Unknown";
  const department = row.department?.trim() || null;
  const feedbackEntries = Array.isArray(row.feedbackEntries) ? row.feedbackEntries : [];
  const channel = row.channel === "slack" ? "slack" : "web";
  const summarizedRating =
    row.summarizedRating === "positive" || row.summarizedRating === "negative"
      ? row.summarizedRating
      : "none";

  const question = expanded ? questionText : questionExcerpt;
  const answer = expanded ? answerText : answerExcerpt;
  const isTruncated =
    questionText.length > questionExcerpt.length || answerText.length > answerExcerpt.length;
  const showToggle = expanded || isTruncated;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            summarizedRating === "positive"
              ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
              : summarizedRating === "negative"
                ? "rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
                : "rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
          }
        >
          {summarizedRating === "positive"
            ? "Positive"
            : summarizedRating === "negative"
              ? "Negative"
              : "No feedback"}
        </span>
        <span className="rounded bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-medium text-[var(--acton-navy)]">
          {channel === "slack" ? "Slack" : "Web"}
        </span>
        <CardDescription className="!mt-0">
          {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"} · Asked by {askerLabel}
          {department ? ` · ${department}` : " · Unassigned"}
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
      {feedbackEntries.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--acton-muted)]">No feedback</p>
      ) : (
        <div className="mt-2 space-y-2">
          {feedbackEntries.map((entry) => {
            const commenterLabel = asText(entry?.commenterLabel).trim() || "Unknown";
            const rating = entry?.rating === "up" ? "up" : "down";
            return (
              <div
                key={asText(entry?.id) || `${commenterLabel}-${asText(entry?.createdAt)}`}
                className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-soft)]/40 px-3 py-2 text-sm"
              >
                <p className="font-medium text-[var(--acton-navy)]">
                  {rating === "up" ? "👍 Positive" : "👎 Negative"} · {commenterLabel}
                  {entry?.createdAt ? (
                    <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  ) : null}
                </p>
                {entry?.comment ? (
                  <p className="mt-1 whitespace-pre-wrap text-[var(--acton-navy)]">
                    {entry.comment}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--acton-muted)]">
        Mode: {row.answerMode ?? "—"} · Sources:{" "}
        {Number.isFinite(row.sourceCount) ? row.sourceCount : 0}
        {row.errorCode ? ` · Error: ${row.errorCode}` : ""}
      </p>
    </Card>
  );
}
