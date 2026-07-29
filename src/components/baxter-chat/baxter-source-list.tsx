"use client";

import type { BaxterSourceReference } from "@/lib/baxter-ai/types";
import { formatRelativeUpdated } from "@/lib/baxter-ai/citations";

function confidenceLabel(score: number): string {
  if (score >= 40) return "High match";
  if (score >= 15) return "Medium match";
  return "Lower match";
}

export function BaxterSourceList({ sources }: { sources: BaxterSourceReference[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        Sources
      </p>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li
            key={`${source.citationLabel}-${source.knowledgeEntryId ?? source.title}`}
            className="text-xs text-[var(--acton-navy)]"
          >
            <p className="font-semibold">{source.citationLabel}</p>
            {(source.pageNumber != null || source.slideNumber != null) &&
            !/page\s+\d+|slide\s+\d+/i.test(source.citationLabel) ? (
              <p className="text-[var(--acton-muted)]">
                {source.pageNumber != null
                  ? `Page ${source.pageNumber}`
                  : `Slide ${source.slideNumber}`}
              </p>
            ) : null}
            <p className="text-[var(--acton-muted)]">
              {source.sourceKind === "pem_neat"
                ? "Partnership Evaluation Meeting"
                : source.sourceKind.replace(/_/g, " ")}{" "}
              · {formatRelativeUpdated(source.lastUpdated)} ·{" "}
              {confidenceLabel(source.relevanceScore)}
            </p>
            {source.availability === "available" && source.sourceUrl ? (
              <a
                href={source.sourceUrl}
                target={source.sourceUrl.startsWith("http") ? "_blank" : undefined}
                rel={source.sourceUrl.startsWith("http") ? "noopener noreferrer" : undefined}
                className="mt-1 inline-flex font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
              >
                {source.openLabel}
              </a>
            ) : (
              <p className="mt-1 text-[var(--acton-muted)]">Source unavailable</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
