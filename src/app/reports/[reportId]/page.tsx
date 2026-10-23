import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { ReportView } from "@/components/report-builder/report-view";
import { loadReportsPageContext } from "@/lib/reports/page-access";
import { logServerError } from "@/lib/errors";
import { getReport } from "@/lib/reports/repo";
import { getReportStore } from "@/lib/research/report-store";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ reportId: string }> };

export default async function ReportPage({ params }: PageProps) {
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const { user, access, dexterAvatarUrl } = await loadReportsPageContext();
  // `undefined` = the lookup failed (logged); the client then shows the real error instead
  // of a misleading "not found". `null` = no such report.
  const report = await getReport(reportId).catch((error: unknown) => {
    logServerError("ReportPage getReport", error);
    return undefined;
  });
  if (report === null) {
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
          <ReportView
            reportId={reportId}
            canChat={access.canChat}
            dexterAvatarUrl={dexterAvatarUrl}
          />
        </Suspense>
      ) : (
        <ReportsNoAccess />
      )}
    </AppShell>
  );
}
