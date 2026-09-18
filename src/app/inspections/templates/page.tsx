import { AppShell } from "@/components/layout/app-shell";
import { InspectionsShell } from "@/components/inspections/inspections-shell";
import { TemplatesListClient } from "@/components/inspections/templates-list-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listTemplates } from "@/lib/inspections";

export const dynamic = "force-dynamic";

export default async function InspectionTemplatesPage() {
  const user = await requireActiveUser();
  const isAdmin = isAdminRole(user.profile.role);
  const templates = await listTemplates({ includeArchived: isAdmin });

  return (
    <AppShell user={user}>
      <InspectionsShell
        activeView="templates"
        title="Templates"
        subtitle="Reusable checklists. Duplicate Detached ADU to start Attached ADU or Remodel variants."
      >
        <TemplatesListClient initialTemplates={templates} isAdmin={isAdmin} />
      </InspectionsShell>
    </AppShell>
  );
}
