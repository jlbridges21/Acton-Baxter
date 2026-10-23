import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { ReportView } from "@/components/report-builder/report-view";
import { loadReportsPageContext } from "@/lib/reports/page-access";
import { getReport } from "@/lib/reports/repo";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ reportId: string }> };

export default async function ReportPage({ params }: PageProps) {
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const { user, access } = await loadReportsPageContext();
  if (!(await getReport(reportId).catch(() => null))) {
    // Links from before Property Research moved to /property-research keep working.
    const legacy = await getReportStore()
      .getReport(reportId)
      .catch(() => null);
    if (legacy) redirect(`/property-research/${reportId}`);
    notFound();
  }
  return (
    <AppShell user={user}>
      {access?.canUse ? (
        <Suspense fallback={<p className="text-sm text-[var(--acton-muted)]">Loading report…</p>}>
          <ReportView reportId={reportId} canChat={access.canChat} />
        </Suspense>
      ) : (
        <ReportsNoAccess />
      )}
    </AppShell>
  );
}
