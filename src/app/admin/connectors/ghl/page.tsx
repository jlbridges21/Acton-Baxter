import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { GhlConnectorClient } from "@/components/admin/ghl-connector-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getGhlAdminOverview } from "@/lib/connectors/ghl/diagnostics";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";

export default async function AdminGhlConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const overview = await getGhlAdminOverview();
  const write = canUserWriteGhl(user.profile);
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    <AppShell user={user}>
      <Suspense
        fallback={<p className="p-6 text-sm text-[var(--acton-muted)]">Loading Acton CRM…</p>}
      >
        <GhlConnectorClient
          initialOverview={overview}
          canWrite={write.canWrite}
          oauthNotice={{
            success: pick("oauth_success") === "1",
            connectedLocation: pick("connected_location") ?? null,
            reconnectSuccess: pick("reconnect_success") === "1",
            error: pick("oauth_error") ?? null,
            message: pick("oauth_message") ?? null,
          }}
        />
      </Suspense>
    </AppShell>
  );
}
