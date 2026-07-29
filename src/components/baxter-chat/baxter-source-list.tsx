"use client";

import type { BaxterSourceReference } from "@/lib/baxter-ai/types";
import { formatRelativeUpdated } from "@/lib/baxter-ai/citations";

function confidenceLabel(score: number): string {
  if (score >= 40) return "High match";
  if (score >= 15) return "Medium match";
  return "Lower match";
}

function formatSlackWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SlackSourceCard({ source }: { source: BaxterSourceReference }) {
  const when = formatSlackWhen(source.lastUpdated);
  const channel =
    source.sourceName?.startsWith("#") || source.sourceName
      ? source.sourceName.startsWith("#")
        ? source.sourceName
        : `#${source.sourceName}`
      : null;

  return (
    <li
      key={`${source.citationLabel}-${source.knowledgeEntryId ?? source.title}`}
      className="text-xs text-[var(--acton-navy)]"
    >
      <p className="font-semibold">Slack{channel ? ` · ${channel}` : ""}</p>
      <p className="text-[var(--acton-muted)]">
        {source.title}
        {when ? ` · ${when}` : ""}
      </p>
      {source.availability === "available" && source.sourceUrl ? (
        <a
          href={source.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
        >
          {source.openLabel || "View in Slack"}
        </a>
      ) : (
        <p className="mt-1 text-[var(--acton-muted)]">Source unavailable</p>
      )}
    </li>
  );
}

export function BaxterSourceList({ sources }: { sources: BaxterSourceReference[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        Sources
      </p>
      <ul className="mt-2 space-y-2">
        {sources.map((source) =>
          source.sourceKind === "slack" ? (
            <SlackSourceCard
              key={`${source.citationLabel}-${source.knowledgeEntryId ?? source.title}`}
              source={source}
            />
          ) : (
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
          ),
        )}
      </ul>
    </div>
  );
}
