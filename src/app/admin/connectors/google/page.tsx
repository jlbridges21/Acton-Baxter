import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GoogleConnectorClient } from "@/components/admin/google-connector-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGoogleConnector, listGoogleSyncFolders } from "@/lib/connectors/google";

export default async function AdminGoogleConnectorPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const [health, folders] = await Promise.all([
    getGoogleConnector().health(),
    listGoogleSyncFolders(),
  ]);
  return (
    <AppShell user={user}>
      <GoogleConnectorClient initialHealth={health} initialFolders={folders} />
    </AppShell>
  );
}
