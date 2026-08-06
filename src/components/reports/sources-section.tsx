"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { ReportNotice, ReportSection } from "./report-section";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import type { ReportSourceRow } from "@/lib/research/db-types";

function statusTone(status: string) {
  switch (status) {
    case "active":
      return "green" as const;
    case "unavailable":
    case "error":
      return "red" as const;
    case "manual_review":
      return "amber" as const;
    default:
      return "gray" as const;
  }
}

/**
 * Only show "Open source" for real public pages.
 * ATTOM developer portal URLs are not useful to salespeople.
 */
export function isBrowsablePublicSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "api.developer.attomdata.com" || host.endsWith(".attomdata.com")) {
      return false;
    }
    if (host === "example.attomdata.com") return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function SourcesSection({ sources }: { sources: ReportSourceRow[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ReportSection
      id="sources"
      title="Sources"
      description="Every source this report consulted, when it answered, and whether it needs a manual check."
      actions={
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="sources-list"
        >
          {expanded ? "Hide" : "Show"} ({sources.length})
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded ? "rotate-180" : "rotate-0")}
          />
        </button>
      }
    >
      <div id="sources-list" className={cn(expanded ? "block" : "hidden", "print:block")}>
        {sources.length === 0 ? (
          <ReportNotice>No sources were recorded for this report.</ReportNotice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-3 print:gap-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-md border border-[var(--acton-border)] p-4 print:break-inside-avoid print:p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--acton-navy)]">
                  {source.source_name}
                </p>
                <Badge tone={statusTone(source.status)}>{source.status}</Badge>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-[var(--acton-muted)]">
                <div>
                  <dt className="inline font-medium">Retrieved: </dt>
                  <dd className="inline">{formatDate(source.retrieved_at)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Source updated: </dt>
                  <dd className="inline">{formatDate(source.source_updated_at)}</dd>
                </div>
              </dl>
              {source.status_message ? (
                <p className="mt-2 text-xs text-[var(--acton-muted)]">{source.status_message}</p>
              ) : null}
              {isBrowsablePublicSourceUrl(source.source_url) ? (
                <>
                  <a
                    href={source.source_url!}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-navy)] underline print:hidden"
                  >
                    Open source
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <p className="mt-2 hidden text-xs break-all text-[var(--acton-muted)] print:block">
                    {source.source_url}
                  </p>
                </>
              ) : source.source_name.toLowerCase().includes("attom") ? (
                <p className="mt-3 text-xs text-[var(--acton-muted)]">
                  Licensed ATTOM API data (no public webpage).
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </ReportSection>
  );
}
