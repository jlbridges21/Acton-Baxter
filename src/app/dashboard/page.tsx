import { AppShell } from "@/components/layout/app-shell";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getReportStore } from "@/lib/research/report-store";

export default async function DashboardPage() {
  const user = await requireActiveUser();
  const reports = await getReportStore().listReports();

  return (
    <AppShell user={user}>
      <DashboardClient reports={reports} isAdmin={isAdminRole(user.profile.role)} />
    </AppShell>
  );
}
