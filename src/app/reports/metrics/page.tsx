import { AppShell } from "@/components/layout/app-shell";
import { MetricLibrary } from "@/components/report-builder/metric-library";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function MetricLibraryPage() {
  const { user, access } = await loadReportsPageContext();
  return (
    <AppShell user={user}>{access?.canUse ? <MetricLibrary /> : <ReportsNoAccess />}</AppShell>
  );
}
