import { ExternalLink, FileSpreadsheet } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function JurisdictionReportCard({
  title,
  jurisdictionName,
  available,
  reportUrl,
  openLabel,
  thumbnailLabel,
  notes,
  accessType,
  searchHint,
}: {
  title: string;
  jurisdictionName: string;
  available: boolean;
  reportUrl: string | null;
  openLabel: string;
  thumbnailLabel: string;
  notes?: string;
  accessType?: string | null;
  searchHint?: string | null;
}) {
  const accessLabel =
    accessType === "direct_report"
      ? "Direct report"
      : accessType === "deep_link"
        ? "Deep link"
        : accessType === "generic_search"
          ? "Search required"
          : accessType === "recreated_from_layers"
            ? "Recreated from layers"
            : available
              ? "Available"
              : "Unavailable";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{jurisdictionName}</CardDescription>
        </div>
        <Badge tone={available ? "green" : "amber"}>{accessLabel}</Badge>
      </div>

      <div className="mt-4 flex min-h-36 items-center justify-center rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
        <div className="px-4 text-center">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">{thumbnailLabel}</p>
        </div>
      </div>

      {notes ? <p className="mt-3 text-xs text-[var(--acton-muted)]">{notes}</p> : null}
      {searchHint ? (
        <p className="mt-2 text-sm font-medium text-[var(--acton-navy)]">{searchHint}</p>
      ) : null}

      <div className="mt-4 print:hidden">
        {reportUrl ? (
          <a
            href={reportUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
          >
            {openLabel}
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <p className="text-sm text-[var(--acton-muted)]">
            No profile URL stored for this report.
          </p>
        )}
      </div>

      {reportUrl ? (
        <p className="mt-3 hidden text-xs text-[var(--acton-muted)] print:block">
          Profile URL: {reportUrl}
        </p>
      ) : null}
    </Card>
  );
}
