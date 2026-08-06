import { ReportHeader } from "./report-header";
import { ReportToolbar } from "./report-toolbar";
import { ReportSummaryChips } from "./report-summary-chips";
import { ReportSectionNav } from "./report-section-nav";
import { ResearchSummary } from "./research-summary";
import { PropertyImagerySection } from "./property-imagery";
import { PropertyOverview } from "./property-overview";
import { ParcelAndPublicRecords } from "./parcel-and-public-records";
import { PlanningAndHazards } from "./planning-and-hazards";
import { FireAccessSection } from "./fire-access";
import { AduCodeHighlightsSection } from "./adu-code-highlights";
import { SiteObservations } from "./site-observations";
import { SiteInspectionRequired } from "./site-inspection-required";
import { ImportantInconsistencies } from "./important-inconsistencies";
import { PemPreparationSection } from "./pem-preparation";
import { SourcesSection } from "./sources-section";
import { ReportDiagnostics } from "./report-diagnostics";
import type { FullReport } from "@/lib/research/db-types";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import { buildReportNavItems, buildReportSummaryChips } from "@/lib/research/report-view-model";
import type { AduCodeHighlights } from "@/lib/jurisdictions";
import type { SprinklerIndicator } from "@/lib/research/fire-access";
import type { BuildableEnvelopeResult } from "@/lib/research/buildable-envelope";
import type { FireAccessHydrantView } from "./fire-access";

const DISCLAIMER =
  "This report summarizes licensed and publicly available property information for sales preparation. It is not a zoning determination, title report, survey, site measurement, or feasibility conclusion. Information must be verified during Acton’s feasibility process and with the appropriate public agencies.";

export function ReportDocument({
  report,
  codeHighlights,
  buildable,
  fireAccess,
  isAdmin = false,
  showDiagnostics = false,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Property Research",
  logoAlt = "Acton ADU logo",
}: {
  report: FullReport;
  codeHighlights: AduCodeHighlights;
  buildable: BuildableEnvelopeResult;
  fireAccess: {
    hydrant: FireAccessHydrantView;
    sprinkler: SprinklerIndicator;
  };
  isAdmin?: boolean;
  showDiagnostics?: boolean;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const overlaysFact = report.facts.find((fact) => fact.field_key === "general_plan");
  const overlays =
    report.jurisdiction_name?.toLowerCase().includes("san jose") && overlaysFact ? [] : [];

  const overlayNames = report.siteObservations
    .filter((obs) => obs.observation_type === "overlay")
    .map((obs) => obs.title.replace(/^Overlay:\s*/i, ""));

  const siteInspectionItems = buildSiteInspectionItems(report);
  const chips = buildReportSummaryChips({ report, buildable, hydrant: fireAccess.hydrant });

  // Sections that render nothing must not appear in the nav.
  const navItems = buildReportNavItems({
    observations: report.siteObservations.length > 0,
    "site-inspection": siteInspectionItems.length > 0,
    "pem-preparation": report.pemPreparation != null,
    diagnostics: showDiagnostics && isAdmin,
  });

  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6 print:block">
      <ReportSectionNav sections={navItems} />

      <article className="report-document space-y-5 rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm sm:p-6 lg:p-8">
        <ReportToolbar reportId={report.id} />

        <ReportHeader
          report={report}
          logoUrl={logoUrl}
          companyName={companyName}
          reportTitle={reportTitle}
          logoAlt={logoAlt}
        />
        <ReportSummaryChips chips={chips} />
        <ResearchSummary summary={report.summary} />
        <PropertyImagerySection report={report} />
        <PropertyOverview facts={report.facts} claims={report.claims} />
        <ParcelAndPublicRecords report={report} buildable={buildable} />
        <PlanningAndHazards
          facts={report.facts}
          overlays={overlayNames.length > 0 ? overlayNames : overlays}
        />
        <FireAccessSection hydrant={fireAccess.hydrant} sprinkler={fireAccess.sprinkler} />
        <AduCodeHighlightsSection highlights={codeHighlights} buildable={buildable} />
        <SiteInspectionRequired items={siteInspectionItems} />
        <SiteObservations observations={report.siteObservations} />
        <ImportantInconsistencies conflicts={report.conflicts} />
        <PemPreparationSection pem={report.pemPreparation} />
        <SourcesSection sources={report.sources} />
        {showDiagnostics && isAdmin ? <ReportDiagnostics report={report} /> : null}

        <footer className="border-t border-[var(--acton-border)] pt-4 text-xs text-[var(--acton-muted)]">
          <p>{DISCLAIMER}</p>
        </footer>
      </article>
    </div>
  );
}
