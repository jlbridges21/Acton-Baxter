import { AppNav } from "./app-nav";
import type { AuthUser } from "@/lib/auth/session";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";

export async function AppShell({
  user,
  children,
  width = "contained",
}: {
  user: AuthUser;
  children: React.ReactNode;
  width?: "contained" | "full";
}) {
  const branding = await getBrandingWithLogo();
  const full = width === "full";

  return (
    <div
      className={
        full
          ? "flex h-dvh flex-col bg-[var(--acton-gray-50)]"
          : "min-h-screen bg-[var(--acton-gray-50)]"
      }
    >
      <AppNav
        userName={user.profile.full_name || user.email}
        userRole={user.profile.role}
        userEmail={user.email}
        logoUrl={branding.logoUrl}
        companyName={branding.companyName}
        reportTitle={branding.reportTitle}
        logoAlt={branding.logoAltText}
        fullWidth={full}
      />
      <main
        className={
          full ? "min-h-0 flex-1 overflow-hidden" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
