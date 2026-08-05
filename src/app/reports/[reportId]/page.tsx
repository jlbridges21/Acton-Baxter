import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportDocument } from "@/components/reports/report-document";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";
import { buildAduCodeHighlights, resolveJurisdictionKeyFromReport } from "@/lib/jurisdictions";
import { buildSprinklerIndicator, loadSprinklerThreshold } from "@/lib/research/fire-access";
import { FIELD_KEYS } from "@/lib/research/constants";

type PageProps = {
  params: Promise<{ reportId: string }>;
};

type HydrantDiagnostics = {
  status?: "ok" | "no_data";
  distanceFt?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  statusMessage?: string | null;
};

export default async function ReportPage({ params }: PageProps) {
  const user = await requireActiveUser();
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();

  const report = await getReportStore().getFullReport(reportId);
  if (!report) notFound();

  if (report.status !== "complete") {
    redirect(`/reports/${reportId}/processing`);
  }

  const isAdmin = isAdminRole(user.profile.role);
  const showDiagnostics = isAdmin && process.env.NODE_ENV !== "production";
  const branding = await getBrandingWithLogo();
  const jurisdictionKey = resolveJurisdictionKeyFromReport(report);
  const zoning =
    report.facts.find((fact) => fact.field_key === "zoning")?.normalized_value_text ?? null;
  const codeHighlights = await buildAduCodeHighlights({
    jurisdictionKey,
    zoning,
  });

  const diagnostics = (report.research_diagnostics_json ?? {}) as {
    hydrant?: HydrantDiagnostics;
  };
  const hydrantDiag = diagnostics.hydrant;
  const distanceFact = report.facts.find(
    (fact) => fact.field_key === FIELD_KEYS.nearestHydrantDistanceFt,
  );
  const distanceFt =
    hydrantDiag?.distanceFt ??
    distanceFact?.normalized_value_number ??
    (distanceFact?.normalized_value_text
      ? Number(distanceFact.normalized_value_text.replace(/[^\d.]/g, ""))
      : null);
  const hydrantOk =
    hydrantDiag?.status === "ok" || (typeof distanceFt === "number" && Number.isFinite(distanceFt));

  const threshold = await loadSprinklerThreshold(jurisdictionKey);
  const sprinkler = buildSprinklerIndicator({
    jurisdictionKey,
    jurisdictionName: report.jurisdiction_name,
    distanceFt: hydrantOk && typeof distanceFt === "number" ? distanceFt : null,
    thresholdFt: threshold.thresholdFt,
    sourceCitation: threshold.sourceCitation,
  });

  return (
    <AppShell user={user}>
      <ReportDocument
        report={report}
        codeHighlights={codeHighlights}
        fireAccess={{
          hydrant: {
            status: hydrantOk ? "ok" : "no_data",
            distanceFt: hydrantOk && typeof distanceFt === "number" ? distanceFt : null,
            sourceLabel: hydrantDiag?.sourceLabel ?? distanceFact?.preferred_source_name ?? null,
            sourceUrl: hydrantDiag?.sourceUrl ?? distanceFact?.preferred_source_url ?? null,
            statusMessage: hydrantDiag?.statusMessage ?? null,
            manualLookupUrl:
              report.latitude != null && report.longitude != null
                ? `https://www.openstreetmap.org/#map=18/${report.latitude}/${report.longitude}`
                : null,
          },
          sprinkler,
        }}
        isAdmin={isAdmin}
        showDiagnostics={showDiagnostics}
        logoUrl={branding.logoUrl}
        companyName={branding.companyName}
        reportTitle={branding.reportTitle}
        logoAlt={branding.logoAltText}
      />
    </AppShell>
  );
}
