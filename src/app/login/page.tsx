import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";

export default async function LoginPage() {
  const branding = await getBrandingWithLogo();

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-[var(--acton-muted)]">
          Loading sign-in...
        </div>
      }
    >
      <LoginForm
        logoUrl={branding.logoUrl}
        companyName={branding.companyName}
        reportTitle={branding.reportTitle}
        logoAlt={branding.logoAltText}
      />
    </Suspense>
  );
}
