"use client";

import { Card } from "@/components/ui/card";
import {
  formatMeetingOutcomeLabel,
  formatMoneyLike,
  meetingOutcomeTone,
} from "@/components/pem-neat/pem-neat-formatters";
import {
  ProseBlock,
  SectionHeading,
  SubSectionHeading,
} from "@/components/pem-neat/section-heading";
import { cn } from "@/lib/utils";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";

function PainList({
  items,
  title,
}: {
  items: PemNeatStructuredResult["salesIntelligence"]["type1Pain"];
  title: string;
}) {
  if (items.length === 0) {
    return (
      <div>
        <SubSectionHeading>{title}</SubSectionHeading>
        <ProseBlock className="mt-2" emptyLabel="Not established">
          {null}
        </ProseBlock>
      </div>
    );
  }
  return (
    <div>
      <SubSectionHeading>{title}</SubSectionHeading>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[var(--acton-navy)]">
        {items.map((pain, i) => (
          <li key={i}>
            <span>{pain.statement}</span>
            {pain.whyNow ? (
              <span className="mt-0.5 block text-[var(--acton-muted)]">Why now: {pain.whyNow}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BudgetSection({
  budget,
}: {
  budget: PemNeatStructuredResult["salesIntelligence"]["budget"];
}) {
  const summary = budget.summary?.trim();
  const rows: { label: string; content: React.ReactNode }[] = [];

  if (budget.target?.value?.trim()) {
    rows.push({
      label: "Customer stated target",
      content: formatMoneyLike(budget.target.value) || budget.target.value,
    });
  } else if (budget.statedBudget?.value?.trim()) {
    rows.push({
      label: "Customer stated target",
      content: formatMoneyLike(budget.statedBudget.value) || budget.statedBudget.value,
    });
  }
  if (budget.range?.trim()) rows.push({ label: "Range", content: budget.range });
  if (budget.hardCeiling?.value?.trim()) {
    rows.push({
      label: "Comfort / hard ceiling",
      content: formatMoneyLike(budget.hardCeiling.value) || budget.hardCeiling.value,
    });
  }
  if (budget.scope?.trim()) rows.push({ label: "Scope", content: budget.scope });
  if (budget.fundingSource?.trim()) rows.push({ label: "Funding", content: budget.fundingSource });
  if (budget.firmness?.trim()) rows.push({ label: "Firmness", content: budget.firmness });

  if (budget.competitorAnchors.length > 0) {
    rows.push({
      label: "Competitor anchors",
      content: (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {budget.competitorAnchors.map((a, i) => (
            <li key={i}>
              {[a.source, a.amount ? formatMoneyLike(a.amount) || a.amount : null]
                .filter(Boolean)
                .join(" — ")}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (budget.advisorEstimates.length > 0) {
    rows.push({
      label: "Advisor estimates",
      content: (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {budget.advisorEstimates.map((a, i) => (
            <li key={i}>
              {[a.description, a.amount ? formatMoneyLike(a.amount) || a.amount : null]
                .filter(Boolean)
                .join(" — ")}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (budget.risks.length > 0) {
    rows.push({
      label: "Risks",
      content: (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {budget.risks.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ),
    });
  }
  if (budget.unknowns.length > 0) {
    rows.push({
      label: "Unknowns",
      content: (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {budget.unknowns.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      ),
    });
  }

  if (!summary && rows.length === 0) {
    return (
      <div>
        <SubSectionHeading>5. Budget</SubSectionHeading>
        <ProseBlock className="mt-2" emptyLabel="Not established">
          {null}
        </ProseBlock>
      </div>
    );
  }

  return (
    <div>
      <SubSectionHeading>5. Budget</SubSectionHeading>
      <div className="mt-2 space-y-3">
        {summary ? <ProseBlock>{summary}</ProseBlock> : null}
        {rows.map((row) => (
          <div key={row.label}>
            <p className="text-sm font-medium text-[var(--acton-navy)]">{row.label}</p>
            <div className="mt-0.5 text-sm text-[var(--acton-muted)]">{row.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidencedField({
  label,
  field,
}: {
  label: string;
  field: { value: string | null } | null | undefined;
}) {
  if (!field?.value?.trim()) return null;
  return (
    <p className="text-sm text-[var(--acton-navy)]">
      <span className="font-medium">{label}:</span> {field.value}
    </p>
  );
}

function hasScheduleContent(
  schedule: PemNeatStructuredResult["salesIntelligence"]["schedule"],
): boolean {
  return Boolean(
    schedule.decisionTiming?.value ||
    schedule.desiredStart?.value ||
    schedule.desiredCompletion?.value ||
    schedule.drivers.length ||
    schedule.summary?.trim(),
  );
}

export function NeatSalesIntelligencePanel({
  sales,
}: {
  sales: PemNeatStructuredResult["salesIntelligence"];
}) {
  const outcomeTone = meetingOutcomeTone(sales.meetingOutcome.classification);
  const showSchedule = hasScheduleContent(sales.schedule);
  const showCompetition = sales.competitionAlternatives.length > 0;

  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <SectionHeading>Sales Intelligence</SectionHeading>

        <div>
          <SubSectionHeading>1. Customer Story</SubSectionHeading>
          <ProseBlock className="mt-2">{sales.customerStory}</ProseBlock>
        </div>

        <div>
          <SubSectionHeading>2. Customer Pain</SubSectionHeading>
          <ProseBlock className="mt-2">{sales.customerPain}</ProseBlock>
        </div>

        <PainList items={sales.type1Pain} title="3. Type 1 Pain — Why Build an ADU" />
        <PainList items={sales.type2Pain} title="4. Type 2 Pain — Why Choose Acton" />

        <BudgetSection budget={sales.budget} />

        <div>
          <SubSectionHeading>6. Decision-Making Process</SubSectionHeading>
          <div className="mt-2 space-y-2">
            <ProseBlock emptyLabel="Not established">
              {sales.decisionProcess.summary ?? sales.decisionProcess.process}
            </ProseBlock>
            {sales.decisionProcess.decisionMakers.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-[var(--acton-navy)]">Decision makers</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--acton-muted)]">
                  {sales.decisionProcess.decisionMakers.map((dm, i) => (
                    <li key={i}>{dm?.value ?? "—"}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {sales.decisionProcess.criteria.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-[var(--acton-navy)]">Criteria</p>
                <p className="text-sm text-[var(--acton-muted)]">
                  {sales.decisionProcess.criteria.join("; ")}
                </p>
              </div>
            ) : null}
            {sales.decisionProcess.alternatives.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-[var(--acton-navy)]">Alternatives</p>
                <p className="text-sm text-[var(--acton-muted)]">
                  {sales.decisionProcess.alternatives.join("; ")}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {showSchedule ? (
          <div>
            <SubSectionHeading>Schedule</SubSectionHeading>
            <div className="mt-2 space-y-1">
              <EvidencedField label="Decision timing" field={sales.schedule.decisionTiming} />
              <EvidencedField label="Desired start" field={sales.schedule.desiredStart} />
              <EvidencedField label="Desired completion" field={sales.schedule.desiredCompletion} />
              {sales.schedule.drivers.length > 0 ? (
                <p className="text-sm text-[var(--acton-navy)]">
                  <span className="font-medium">Drivers:</span> {sales.schedule.drivers.join("; ")}
                </p>
              ) : null}
              {sales.schedule.summary ? (
                <ProseBlock className="mt-1">{sales.schedule.summary}</ProseBlock>
              ) : null}
            </div>
          </div>
        ) : null}

        {showCompetition ? (
          <div>
            <SubSectionHeading>Competition / Alternatives</SubSectionHeading>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
              {sales.competitionAlternatives.map((alt, i) => (
                <li key={i}>{alt}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <SubSectionHeading>7. Acton Recommendation</SubSectionHeading>
          <div className="mt-2 space-y-1">
            {sales.actonRecommendation.fit ? (
              <p className="text-sm font-medium text-[var(--acton-navy)]">
                Fit: {sales.actonRecommendation.fit}
              </p>
            ) : null}
            <ProseBlock>{sales.actonRecommendation.reasoning}</ProseBlock>
          </div>
        </div>

        <div>
          <SubSectionHeading>8. Next Steps</SubSectionHeading>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Prospect
              </p>
              {sales.nextSteps.prospect.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--acton-muted)]">—</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
                  {sales.nextSteps.prospect.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Acton
              </p>
              {sales.nextSteps.acton.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--acton-muted)]">—</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
                  {sales.nextSteps.acton.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card
        className={cn(
          "border-2",
          outcomeTone === "green" && "border-emerald-300 bg-emerald-50/50",
          outcomeTone === "red" && "border-red-300 bg-red-50/50",
          outcomeTone === "blue" && "border-sky-300 bg-sky-50/50",
          outcomeTone === "amber" && "border-amber-300 bg-amber-50/50",
          outcomeTone === "gray" && "border-[var(--acton-border)]",
        )}
      >
        <SectionHeading>9. Meeting Outcome</SectionHeading>
        <p className="mt-3 text-lg font-bold text-[var(--acton-navy)]">
          {formatMeetingOutcomeLabel(sales.meetingOutcome.classification)}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--acton-navy)]">
          {sales.meetingOutcome.explanation}
        </p>
      </Card>
    </div>
  );
}
