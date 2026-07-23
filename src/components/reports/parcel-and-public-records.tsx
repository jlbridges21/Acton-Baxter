import { ExternalLink, Map } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { FullReport } from "@/lib/research/db-types";
import { formatNumber } from "@/lib/utils";
import { JurisdictionReportCard } from "./jurisdiction-report-card";

function LinkRow({ label, href }: { label: string; href: string | null | undefined }) {
  if (!href) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-[var(--acton-border)] py-2 text-sm">
        <span className="text-[var(--acton-muted)]">{label}</span>
        <span className="text-[var(--acton-muted)]">Not available</span>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--acton-border)] py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--acton-navy)]">{label}</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[var(--acton-navy)] underline print:hidden"
        >
          Open
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <p className="mt-1 hidden text-xs break-all text-[var(--acton-muted)] print:block">{href}</p>
    </div>
  );
}

export function ParcelAndPublicRecords({ report }: { report: FullReport }) {
  const profileUrl = report.property_profile_url ?? null;
  const accessType = report.property_profile_access_type ?? null;
  const parcelUrl = report.parcelGeometry?.source_url ?? null;
  const assessorUrl = report.apn
    ? `https://www.sccassessor.org/index.php/online-services/property-search?apn=${report.apn}`
    : null;
  const tractUrl = assessorUrl;
  const permitUrl = report.jurisdiction_name?.toLowerCase().includes("san jose")
    ? `https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-permits?q=${encodeURIComponent(report.standardized_address ?? report.input_address)}`
    : null;

  const openLabel =
    accessType === "direct_report"
      ? "Open County Property Profile"
      : accessType === "recreated_from_layers"
        ? "Open County Mapping Source"
        : "Search County Property Profile";

  const notes =
    report.property_profile_status_message ??
    "County Property Profile access depends on public ArcGIS Experience capabilities.";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Parcel and public records</CardTitle>
        <CardDescription>
          Parcel boundary and official record links for salesperson follow-up.
        </CardDescription>
        <div className="mt-4 flex min-h-40 items-center justify-center rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
          <div className="px-4 text-center">
            <Map className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
              Parcel map preview
            </p>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {report.parcelGeometry
                ? `Parcel polygon · ~${formatNumber(report.parcelGeometry.calculated_area_sq_ft)} sq ft calculated`
                : "Parcel geometry unavailable"}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <LinkRow label="County Property Profile Report" href={profileUrl} />
          <LinkRow label="Parcel GIS" href={parcelUrl} />
          <LinkRow label="Tract / assessor search" href={tractUrl} />
          <LinkRow label="Assessor" href={assessorUrl} />
          <LinkRow label="Permit search" href={permitUrl} />
        </div>
      </Card>

      <JurisdictionReportCard
        title="Santa Clara County Property Profile Report"
        jurisdictionName="Santa Clara County"
        available={Boolean(profileUrl)}
        reportUrl={profileUrl}
        openLabel={openLabel}
        thumbnailLabel="Property profile preview"
        notes={notes}
        accessType={accessType}
        searchHint={
          accessType === "generic_search" && report.apn ? `Search using APN ${report.apn}` : null
        }
      />
    </div>
  );
}
