"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import {
  AssessmentStatusBadge,
  QualificationBadge,
} from "@/components/pem-neat/pem-neat-formatters";
import { SectionHeading, SubSectionHeading } from "@/components/pem-neat/section-heading";
import { ASSESSMENT_CATEGORY_LABELS, type AssessmentCategoryKey } from "@/lib/pem-neat/constants";
import { computeOverallScore } from "@/lib/pem-neat/coverage";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { cn } from "@/lib/utils";

function isPlaceholder(text: string | null | undefined): boolean {
  if (!text?.trim()) return true;
  return /not enough evidence|not established/i.test(text);
}

export function NeatAssessmentPanel({
  assessment,
  qualification,
}: {
  assessment: PemNeatStructuredResult["assessment"];
  qualification: PemNeatStructuredResult["salesIntelligence"]["qualification"];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const overall =
    (assessment as { overallScore?: number | null }).overallScore ??
    computeOverallScore(assessment.categories);

  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <SectionHeading>Sales Assessment</SectionHeading>

        <div>
          <SubSectionHeading>Qualification</SubSectionHeading>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <QualificationBadge level={qualification.classification} />
          </div>
          {!isPlaceholder(qualification.reasoning) ? (
            <p className="mt-2 text-sm text-[var(--acton-navy)]">{qualification.reasoning}</p>
          ) : null}
          {qualification.risks.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--acton-muted)]">
              {qualification.risks.map((risk, i) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {assessment.topStrengths.length > 0 ? (
          <div>
            <SubSectionHeading>Top Strengths</SubSectionHeading>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
              {assessment.topStrengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {assessment.topImprovements.length > 0 ? (
          <div>
            <SubSectionHeading>Top Improvements</SubSectionHeading>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
              {assessment.topImprovements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {!isPlaceholder(assessment.oneThing) ? (
          <div className="rounded-md border-2 border-[var(--acton-yellow)] bg-[var(--acton-gray-50)] p-4">
            <SubSectionHeading>The One Thing / Main Coaching Point</SubSectionHeading>
            <p className="mt-2 text-sm leading-relaxed font-medium text-[var(--acton-navy)]">
              {assessment.oneThing}
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeading>Sales System Score</SectionHeading>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--acton-border)] text-left text-[var(--acton-muted)]">
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Score</th>
                <th className="py-2 font-medium">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {assessment.categories.map((cat) => {
                const label =
                  ASSESSMENT_CATEGORY_LABELS[cat.key as AssessmentCategoryKey] ?? cat.label;
                const explanation =
                  (!isPlaceholder(cat.evidence) && cat.evidence) ||
                  (!isPlaceholder(cat.whatWorked) && cat.whatWorked) ||
                  (!isPlaceholder(cat.coachingOpportunity) && cat.coachingOpportunity) ||
                  (cat.status === "NOT_DETERMINABLE"
                    ? "Not enough transcript evidence to score this category."
                    : "—");
                const isOpen = expanded === cat.key;
                return (
                  <tr key={cat.key} className="border-b border-[var(--acton-border)] align-top">
                    <td className="py-2.5 pr-3 font-medium text-[var(--acton-navy)]">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setExpanded(isOpen ? null : cat.key)}
                        aria-expanded={isOpen}
                      >
                        {label}
                      </button>
                      {isOpen ? (
                        <div className="mt-2 space-y-1 text-xs font-normal text-[var(--acton-muted)]">
                          <AssessmentStatusBadge status={cat.status} />
                          {cat.evidence && !isPlaceholder(cat.evidence) ? (
                            <p>
                              <span className="font-medium text-[var(--acton-navy)]">
                                Evidence:
                              </span>{" "}
                              {cat.evidence}
                            </p>
                          ) : null}
                          {cat.whatWorked && !isPlaceholder(cat.whatWorked) ? (
                            <p>
                              <span className="font-medium text-[var(--acton-navy)]">
                                What worked:
                              </span>{" "}
                              {cat.whatWorked}
                            </p>
                          ) : null}
                          {cat.coachingOpportunity && !isPlaceholder(cat.coachingOpportunity) ? (
                            <p>
                              <span className="font-medium text-[var(--acton-navy)]">
                                Coaching:
                              </span>{" "}
                              {cat.coachingOpportunity}
                            </p>
                          ) : null}
                          {cat.key === "palo_upfront_contract" && cat.palo ? (
                            <div className="mt-1 grid gap-1 sm:grid-cols-2">
                              {(["purpose", "agenda", "logistics", "outcome"] as const).map(
                                (part) => (
                                  <div
                                    key={part}
                                    className={cn(
                                      "rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-1.5",
                                    )}
                                  >
                                    <span className="text-[10px] font-bold tracking-wide uppercase">
                                      {part}
                                    </span>{" "}
                                    <AssessmentStatusBadge status={cat.palo![part].status} />
                                  </div>
                                ),
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold whitespace-nowrap text-[var(--acton-navy)]">
                      {cat.score != null ? cat.score : "—"}
                    </td>
                    <td className="py-2.5 text-[var(--acton-muted)]">{explanation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {overall != null ? (
          <p className="mt-4 text-base font-bold text-[var(--acton-navy)]">
            Overall Score: {overall} / 10
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--acton-muted)]">
          Overall score is the mean of determinable category scores (excludes NOT DETERMINABLE /
          N/A). Click a category for evidence and coaching detail.
        </p>
      </Card>
    </div>
  );
}
