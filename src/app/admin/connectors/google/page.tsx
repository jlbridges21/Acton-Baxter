import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GoogleConnectorClient } from "@/components/admin/google-connector-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGoogleAdminOverview } from "@/lib/connectors/google/diagnostics";

export default async function AdminGoogleConnectorPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const overview = await getGoogleAdminOverview();
  return (
    <AppShell user={user}>
      <GoogleConnectorClient
        initialHealth={overview.health}
        initialFolders={overview.folders}
        initialConfig={overview.config}
        initialAuthenticated={overview.authenticated}
        initialManagerHealth={overview.managerHealth}
      />
    </AppShell>
  );
}
