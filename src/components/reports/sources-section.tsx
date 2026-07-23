import { ExternalLink } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
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

export function SourcesSection({ sources }: { sources: ReportSourceRow[] }) {
  return (
    <Card>
      <CardTitle>Sources</CardTitle>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {sources.map((source) => (
          <div
            key={source.id}
            className="rounded-md border border-[var(--acton-border)] p-4 print:break-inside-avoid"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--acton-navy)]">{source.source_name}</p>
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
            {source.source_url ? (
              <>
                <a
                  href={source.source_url}
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
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
