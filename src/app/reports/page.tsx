import { AppShell } from "@/components/layout/app-shell";
import { ReportHistoryClient } from "@/components/reports/report-history-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getReportStore } from "@/lib/research/report-store";

export default async function ReportsPage() {
  const user = await requireActiveUser();
  const reports = await getReportStore().listReports();

  return (
    <AppShell user={user}>
      <ReportHistoryClient reports={reports} />
    </AppShell>
  );
}
