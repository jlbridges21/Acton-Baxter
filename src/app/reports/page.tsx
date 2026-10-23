import { AppShell } from "@/components/layout/app-shell";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { ReportsHub } from "@/components/report-builder/reports-hub";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { user, access } = await loadReportsPageContext();
  return <AppShell user={user}>{access?.canUse ? <ReportsHub /> : <ReportsNoAccess />}</AppShell>;
}
