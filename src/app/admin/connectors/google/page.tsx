import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GoogleConnectorClient } from "@/components/admin/google-connector-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGoogleAdminOverview } from "@/lib/connectors/google/diagnostics";

export default async function AdminGoogleConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const overview = await getGoogleAdminOverview();
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    <AppShell user={user}>
      <GoogleConnectorClient
        initialHealth={overview.health}
        initialFolders={overview.folders}
        initialConfig={overview.config}
        initialAuthenticated={overview.authenticated}
        initialManagerHealth={overview.managerHealth}
        initialAccessMode={overview.accessMode}
        initialWritesEnabled={overview.writesEnabled}
        oauthNotice={{
          success: pick("oauth_success") === "1",
          connectedAs: pick("connected_as") ?? null,
          error: pick("oauth_error") ?? null,
          message: pick("oauth_message") ?? null,
          offerReconnect:
            pick("oauth_reconnect") === "1" ||
            pick("oauth_error") === "BAXTER_GOOGLE_ACCOUNT_NOT_ALLOWED" ||
            pick("oauth_error") === "BAXTER_GOOGLE_REFRESH_TOKEN_MISSING",
        }}
      />
    </AppShell>
  );
}
