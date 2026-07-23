import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ProviderTestClient } from "@/components/admin/provider-test-client";
import { requireUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";

export default async function ProviderTestPage() {
  const user = await requireUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }
  if (process.env.NODE_ENV === "production") {
    redirect("/admin/sources");
  }

  return (
    <AppShell user={user}>
      <ProviderTestClient />
    </AppShell>
  );
}
