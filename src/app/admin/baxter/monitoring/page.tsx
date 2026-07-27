import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { MonitoringClient } from "@/components/admin/monitoring-client";

export default async function BaxterMonitoringPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  return (
    <AppShell user={user}>
      <MonitoringClient />
    </AppShell>
  );
}
