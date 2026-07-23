import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/utils";
import type { SourceHealthView } from "@/lib/research/source-health";

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

export function SourceHealthTable({ sources }: { sources: SourceHealthView[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Source health</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Admin view of provider and connector health. Paid providers show configuration status; use
          Provider Test for manual live calls.
        </p>
      </div>

      <Card>
        <CardTitle>Connectors and providers</CardTitle>
        <CardDescription>
          Live endpoint validation arrives with Prompt 2 integrations.
        </CardDescription>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--acton-border)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Last checked</th>
                <th className="py-2 pr-4 font-medium">Response time</th>
                <th className="py-2 pr-4 font-medium">Schema valid</th>
                <th className="py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr
                  key={`${source.provider}-${source.sourceName}`}
                  className="border-b border-[var(--acton-border)] align-top"
                >
                  <td className="py-3 pr-4 font-medium text-[var(--acton-navy)]">
                    {source.sourceName}
                  </td>
                  <td className="py-3 pr-4 text-[var(--acton-muted)]">{source.provider}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={statusTone(source.status)}>{source.status}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-[var(--acton-muted)]">
                    {formatDate(source.lastChecked)}
                  </td>
                  <td className="py-3 pr-4 text-[var(--acton-muted)]">
                    {source.responseTimeMs === null
                      ? "—"
                      : `${formatNumber(source.responseTimeMs)} ms`}
                  </td>
                  <td className="py-3 pr-4 text-[var(--acton-muted)]">
                    {source.schemaValid === null ? "—" : source.schemaValid ? "Yes" : "No"}
                  </td>
                  <td className="py-3 text-[var(--acton-muted)]">{source.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
