import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { BrandingForm } from "@/components/admin/branding-form";
import { requireUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";

export default async function AdminBrandingPage() {
  const user = await requireUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const branding = await getBrandingWithLogo();

  return (
    <AppShell user={user}>
      <BrandingForm initial={branding} />
    </AppShell>
  );
}
