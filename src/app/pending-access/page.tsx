import { redirect } from "next/navigation";
import { isAppAccessRole } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { PendingAccessClient } from "./pending-access-client";

export const dynamic = "force-dynamic";

export default async function PendingAccessPage() {
  const user = await requireUser();
  if (isAppAccessRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const branding = await getBrandingWithLogo();

  return (
    <PendingAccessClient
      fullName={user.profile.full_name}
      email={user.email}
      logoUrl={branding.logoUrl}
      companyName={branding.companyName}
      reportTitle={branding.reportTitle}
      logoAlt={branding.logoAltText}
    />
  );
}
