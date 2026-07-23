import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { FullReport } from "@/lib/research/db-types";

export function ReportDiagnostics({ report }: { report: FullReport }) {
  const diagnostics =
    report.research_diagnostics_json && typeof report.research_diagnostics_json === "object"
      ? (report.research_diagnostics_json as Record<string, unknown>)
      : null;

  if (!diagnostics) return null;

  const providerStatuses = Array.isArray(diagnostics.providerStatuses)
    ? (diagnostics.providerStatuses as Array<Record<string, unknown>>)
    : [];
  const selectedSources =
    diagnostics.selectedSources && typeof diagnostics.selectedSources === "object"
      ? (diagnostics.selectedSources as Record<string, string>)
      : {};

  return (
    <Card className="border-dashed print:hidden">
      <CardTitle>Admin diagnostics</CardTitle>
      <CardDescription>
        Development diagnostics only. API keys and raw provider payloads are never shown here.
      </CardDescription>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">ATTOM ID</dt>
          <dd className="font-semibold text-[var(--acton-navy)]">
            {String(diagnostics.attomId ?? report.attom_id ?? "—")}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">RentCast ID</dt>
          <dd className="font-semibold text-[var(--acton-navy)]">
            {String(diagnostics.rentcastId ?? report.rentcast_id ?? "—")}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Connector keys
          </dt>
          <dd className="font-semibold text-[var(--acton-navy)]">
            {Array.isArray(diagnostics.connectorKeys)
              ? diagnostics.connectorKeys.join(", ") || "—"
              : "—"}
          </dd>
        </div>
      </dl>
      {providerStatuses.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-[var(--acton-navy)]">Provider call status</p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--acton-muted)]">
            {providerStatuses.map((item, index) => (
              <li key={`${String(item.provider)}-${index}`}>
                {String(item.provider)}: {String(item.status)}
                {item.responseTimeMs != null ? ` · ${String(item.responseTimeMs)} ms` : ""}
                {item.message ? ` · ${String(item.message)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Object.keys(selectedSources).length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-[var(--acton-navy)]">Selected source by field</p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--acton-muted)]">
            {Object.entries(selectedSources).map(([field, source]) => (
              <li key={field}>
                {field}: {source}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
