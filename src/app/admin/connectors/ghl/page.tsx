import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GhlConnectorClient } from "@/components/admin/ghl-connector-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGhlAdminOverview } from "@/lib/connectors/ghl/diagnostics";

export default async function AdminGhlConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const overview = await getGhlAdminOverview();
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    <AppShell user={user}>
      <GhlConnectorClient
        initialOverview={overview}
        oauthNotice={{
          success: pick("oauth_success") === "1",
          connectedLocation: pick("connected_location") ?? null,
          reconnectSuccess: pick("reconnect_success") === "1",
          error: pick("oauth_error") ?? null,
          message: pick("oauth_message") ?? null,
        }}
      />
    </AppShell>
  );
}
