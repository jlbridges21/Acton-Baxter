import { AppShell } from "@/components/layout/app-shell";
import { BaxterDashboard } from "@/components/baxter/baxter-dashboard";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Authenticated Baxter Dashboard (platform home).
 * Unauthenticated users are redirected to /login by middleware.
 */
export default async function HomePage() {
  const user = await requireActiveUser();
  const branding = await getBrandingWithLogo();
  const chatEnabled = getEnv().BAXTER_CHAT_ENABLED;

  return (
    <AppShell user={user}>
      <BaxterDashboard
        isAdmin={isAdminRole(user.profile.role)}
        logoUrl={branding.logoUrl}
        companyName={branding.companyName}
        reportTitle={branding.reportTitle}
        logoAlt={branding.logoAltText}
        chatEnabled={chatEnabled}
      />
    </AppShell>
  );
}
