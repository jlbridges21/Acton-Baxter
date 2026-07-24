import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ConnectorsDashboardClient } from "@/components/admin/connectors-dashboard-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listConnectorHealth } from "@/lib/connectors/registry";

export default async function AdminConnectorsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const connectors = await listConnectorHealth();
  return (
    <AppShell user={user}>
      <ConnectorsDashboardClient initialConnectors={connectors} />
    </AppShell>
  );
}
