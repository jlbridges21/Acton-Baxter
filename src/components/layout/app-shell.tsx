import { AppNav } from "./app-nav";
import type { AuthUser } from "@/lib/auth/session";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";

export async function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const branding = await getBrandingWithLogo();

  return (
    <div className="min-h-screen bg-[var(--acton-gray-50)]">
      <AppNav
        userName={user.profile.full_name || user.email}
        userRole={user.profile.role}
        userEmail={user.email}
        logoUrl={branding.logoUrl}
        companyName={branding.companyName}
        reportTitle={branding.reportTitle}
        logoAlt={branding.logoAltText}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
