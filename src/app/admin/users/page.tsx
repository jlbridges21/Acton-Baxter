import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getReportStore } from "@/lib/research/report-store";

export default async function AdminUsersPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const profiles = await getReportStore().listProfiles();

  return (
    <AppShell user={user}>
      <AdminUsersClient initialProfiles={profiles} />
    </AppShell>
  );
}
