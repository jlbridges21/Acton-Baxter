"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { ReportHeader } from "./report-header";
import { ResearchSummary } from "./research-summary";
import { PropertyOverview } from "./property-overview";
import { ParcelAndPublicRecords } from "./parcel-and-public-records";
import { PlanningAndHazards } from "./planning-and-hazards";
import { SiteObservations } from "./site-observations";
import { ImportantInconsistencies } from "./important-inconsistencies";
import { PemPreparationSection } from "./pem-preparation";
import { SourcesSection } from "./sources-section";
import { DownloadPdfButton } from "./download-pdf-button";
import { ReportDiagnostics } from "./report-diagnostics";
import { RefreshResearchButton } from "./refresh-research-button";
import { Button } from "@/components/ui/button";
import type { FullReport } from "@/lib/research/db-types";

const DISCLAIMER =
  "This report summarizes licensed and publicly available property information for sales preparation. It is not a zoning determination, title report, survey, site measurement, or feasibility conclusion. Information must be verified during Acton’s feasibility process and with the appropriate public agencies.";

export function ReportDocument({
  report,
  isAdmin = false,
  showDiagnostics = false,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Acton Property Research",
  logoAlt = "Acton ADU logo",
}: {
  report: FullReport;
  isAdmin?: boolean;
  showDiagnostics?: boolean;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const [copied, setCopied] = useState(false);
  const overlaysFact = report.facts.find((fact) => fact.field_key === "general_plan");
  const overlays =
    report.jurisdiction_name?.toLowerCase().includes("san jose") && overlaysFact ? [] : [];

  const overlayNames = report.siteObservations
    .filter((obs) => obs.observation_type === "overlay")
    .map((obs) => obs.title.replace(/^Overlay:\s*/i, ""));

  async function copyReportLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="report-document space-y-5 rounded-xl border border-[var(--acton-border)] bg-white p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-[var(--acton-muted)]">
          Print-friendly report · target length under six pages
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void copyReportLink()}>
            <Link2 className="h-4 w-4" />
            {copied ? "Link copied" : "Copy report link"}
          </Button>
          <RefreshResearchButton reportId={report.id} />
          <DownloadPdfButton />
        </div>
      </div>

      <ReportHeader
        report={report}
        logoUrl={logoUrl}
        companyName={companyName}
        reportTitle={reportTitle}
        logoAlt={logoAlt}
      />
      <ResearchSummary summary={report.summary} />
      <PropertyOverview facts={report.facts} claims={report.claims} />
      <ParcelAndPublicRecords report={report} />
      <PlanningAndHazards
        facts={report.facts}
        overlays={overlayNames.length > 0 ? overlayNames : overlays}
      />
      <SiteObservations observations={report.siteObservations} />
      <ImportantInconsistencies conflicts={report.conflicts} />
      <PemPreparationSection pem={report.pemPreparation} />
      <SourcesSection sources={report.sources} />
      {showDiagnostics && isAdmin ? <ReportDiagnostics report={report} /> : null}

      <footer className="border-t border-[var(--acton-border)] pt-4 text-xs text-[var(--acton-muted)]">
        <p>{DISCLAIMER}</p>
      </footer>
    </article>
  );
}
