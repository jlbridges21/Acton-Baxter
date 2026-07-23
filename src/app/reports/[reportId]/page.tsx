import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportDocument } from "@/components/reports/report-document";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

type PageProps = {
  params: Promise<{ reportId: string }>;
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

  return (
    <AppShell user={user}>
      <ReportDocument
        report={report}
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
