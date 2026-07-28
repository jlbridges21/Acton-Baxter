"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/pem-neat/copy-button";
import { ProjectFactStatusBadge } from "@/components/pem-neat/pem-neat-formatters";
import { ProseBlock, SectionHeading, SubSectionHeading } from "@/components/pem-neat/section-heading";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";

function groupFactsByTopic(facts: PemNeatStructuredResult["projectIntelligence"]["facts"]) {
  const groups = new Map<string, typeof facts>();
  for (const fact of facts) {
    const topicKey = fact.topic.split(/[\s/:-]+/)[0]?.toLowerCase() ?? "general";
    const bucket = groups.get(topicKey) ?? [];
    bucket.push(fact);
    groups.set(topicKey, bucket);
  }
  return groups.size > 1 ? groups : null;
}

export function NeatProjectIntelligencePanel({
  projectIntelligence,
  productionNotes,
  internalOpportunityNotes,
}: {
  projectIntelligence: PemNeatStructuredResult["projectIntelligence"];
  productionNotes: string[];
  internalOpportunityNotes: string;
}) {
  const grouped = useMemo(
    () => groupFactsByTopic(projectIntelligence.facts),
    [projectIntelligence.facts],
  );

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionHeading>Project Intelligence</SectionHeading>

        {projectIntelligence.facts.length === 0 ? (
          <ProseBlock emptyLabel="No project facts captured">{null}</ProseBlock>
        ) : grouped ? (
          <div className="space-y-4">
            {[...grouped.entries()].map(([group, facts]) => (
              <div key={group}>
                <SubSectionHeading className="capitalize">{group}</SubSectionHeading>
                <ul className="mt-2 space-y-2">
                  {facts.map((fact, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-[var(--acton-border)] p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--acton-navy)]">{fact.topic}</span>
                        <ProjectFactStatusBadge status={fact.status} />
                      </div>
                      <p className="mt-1 text-[var(--acton-navy)]">{fact.value ?? "—"}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {projectIntelligence.facts.map((fact, i) => (
              <li
                key={i}
                className="rounded-md border border-[var(--acton-border)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--acton-navy)]">{fact.topic}</span>
                  <ProjectFactStatusBadge status={fact.status} />
                </div>
                <p className="mt-1 text-[var(--acton-navy)]">{fact.value ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}

        {productionNotes.length > 0 ? (
          <div>
            <SubSectionHeading>Production Notes</SubSectionHeading>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
              {productionNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading>Internal Opportunity Notes</SectionHeading>
          <CopyButton
            getText={() => internalOpportunityNotes.trim()}
            label="Copy Notes"
            copiedLabel="Copied"
          />
        </div>
        <ProseBlock>{internalOpportunityNotes}</ProseBlock>
      </Card>
    </div>
  );
}
