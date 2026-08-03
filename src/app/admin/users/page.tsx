import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AdminUsersClient } from "@/components/admin/admin-users-client";
import { isAdminRole } from "@/lib/auth/roles";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { requireActiveUser } from "@/lib/auth/session";
import { listDepartments, listDistinctDepartmentLabels } from "@/lib/org/departments";
import { getReportStore } from "@/lib/research/report-store";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function AdminUsersPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) {
    redirect("/dashboard");
  }

  const [profiles, departments, departmentSuggestions] = await Promise.all([
    getReportStore().listProfiles(),
    listDepartments({ includeInactive: true }),
    listDistinctDepartmentLabels(),
  ]);

  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
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
    department:
      profile.department?.trim() ||
      profile.department_name ||
      (profile.department_id ? (departmentNameById.get(profile.department_id) ?? null) : null),
    department_name:
      profile.department_name ??
      profile.department?.trim() ??
      (profile.department_id ? (departmentNameById.get(profile.department_id) ?? null) : null),
  }));

  return (
    <AppShell user={user}>
      <AdminUsersClient
        initialProfiles={enriched}
        initialDepartments={departments}
        departmentSuggestions={departmentSuggestions}
        viewerEmail={user.email}
        viewerIsSuperAdmin={isSuperAdmin(user)}
      />
    </AppShell>
  );
}
