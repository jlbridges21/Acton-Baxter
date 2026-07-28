"use client";

import { Card } from "@/components/ui/card";
import {
  ASSESSMENT_CATEGORY_LABELS,
  type AssessmentCategoryKey,
} from "@/lib/pem-neat/constants";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { AssessmentStatusBadge, QualificationBadge } from "@/components/pem-neat/pem-neat-formatters";
import { SectionHeading, SubSectionHeading } from "@/components/pem-neat/section-heading";
import { cn } from "@/lib/utils";

export function NeatAssessmentPanel({
  assessment,
  qualification,
}: {
  assessment: PemNeatStructuredResult["assessment"];
  qualification: PemNeatStructuredResult["salesIntelligence"]["qualification"];
}) {
  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <SectionHeading>Sales Assessment</SectionHeading>

        <div>
          <SubSectionHeading>Qualification</SubSectionHeading>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <QualificationBadge level={qualification.classification} />
          </div>
          <p className="mt-2 text-sm text-[var(--acton-navy)]">{qualification.reasoning}</p>
          {qualification.risks.length > 0 ? (
            <div className="mt-2">
              <p className="text-sm font-medium text-[var(--acton-navy)]">Risks</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--acton-muted)]">
                {qualification.risks.map((risk, i) => (
                  <li key={i}>{risk}</li>
                ))}
              </ul>
            </div>
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

        <div className="rounded-md border-2 border-[var(--acton-yellow)] bg-[var(--acton-gray-50)] p-4">
          <SubSectionHeading>The One Thing</SubSectionHeading>
          <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--acton-navy)]">
            {assessment.oneThing}
          </p>
        </div>
      </Card>

      <Card>
        <SectionHeading>Scorecard</SectionHeading>
        <div className="mt-4 space-y-4">
          {assessment.categories.map((cat) => (
            <div
              key={cat.key}
              className="rounded-md border border-[var(--acton-border)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--acton-navy)]">
                  {ASSESSMENT_CATEGORY_LABELS[cat.key as AssessmentCategoryKey] ?? cat.label}
                </h4>
                <span className="text-sm font-bold text-[var(--acton-navy)]">
                  {cat.score != null ? `${cat.score}/10` : "NOT DETERMINABLE"}
                </span>
                <AssessmentStatusBadge status={cat.status} />
              </div>

              {cat.evidence ? (
                <p className="mt-2 text-sm text-[var(--acton-navy)]">
                  <span className="font-medium">Evidence:</span> {cat.evidence}
                </p>
              ) : null}
              {cat.whatWorked ? (
                <p className="mt-1 text-sm text-[var(--acton-muted)]">
                  <span className="font-medium text-[var(--acton-navy)]">What worked:</span>{" "}
                  {cat.whatWorked}
                </p>
              ) : null}
              {cat.coachingOpportunity ? (
                <p className="mt-1 text-sm text-[var(--acton-muted)]">
                  <span className="font-medium text-[var(--acton-navy)]">Coaching:</span>{" "}
                  {cat.coachingOpportunity}
                </p>
              ) : null}

              {cat.key === "palo_upfront_contract" && cat.palo ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(["purpose", "agenda", "logistics", "outcome"] as const).map((part) => {
                    const detail = cat.palo![part];
                    return (
                      <div
                        key={part}
                        className={cn(
                          "rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-2",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold tracking-wide text-[var(--acton-navy)] uppercase">
                            {part}
                          </span>
                          <AssessmentStatusBadge status={detail.status} />
                        </div>
                        {detail.evidence ? (
                          <p className="mt-1 text-xs text-[var(--acton-muted)]">{detail.evidence}</p>
                        ) : null}
                        {detail.notes ? (
                          <p className="mt-0.5 text-xs text-[var(--acton-muted)]">{detail.notes}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
