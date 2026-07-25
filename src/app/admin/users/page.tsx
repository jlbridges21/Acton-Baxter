import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getReportStore } from "@/lib/research/report-store";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function AdminUsersPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const profiles = await getReportStore().listProfiles();
  const emailById = new Map<string, string>();

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (!error) {
      for (const authUser of data.users) {
        if (authUser.id && authUser.email) {
          emailById.set(authUser.id, authUser.email);
        }
      }
    }
  } catch {
    // Email enrichment is best-effort
  }

  const enriched = profiles.map((profile) => ({
    ...profile,
    email: emailById.get(profile.id) ?? null,
  }));

  return (
    <AppShell user={user}>
      <AdminUsersClient
        initialProfiles={enriched}
        viewerEmail={user.email}
        viewerIsSuperAdmin={user.email.trim().toLowerCase() === "baxter@actonadu.com"}
      />
    </AppShell>
  );
}
