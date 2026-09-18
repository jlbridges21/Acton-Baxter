import { AppShell } from "@/components/layout/app-shell";
import { InspectionsShell } from "@/components/inspections/inspections-shell";
import { InspectionsListClient } from "@/components/inspections/inspections-list-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listGovernanceOwnerCandidates } from "@/lib/baxter-ai/governance/owner-candidates";
import { listSiteInspections, listTemplates } from "@/lib/inspections";
import { listExpenseJobs } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export default async function InspectionsPage() {
  const user = await requireActiveUser();
  const [inspections, jobs, templates, assignees] = await Promise.all([
    listSiteInspections(),
    listExpenseJobs({ includeInactive: false }),
    listTemplates({ includeArchived: true }),
    listGovernanceOwnerCandidates(),
  ]);

  return (
    <AppShell user={user}>
      <InspectionsShell
        activeView="inspections"
        title="Site Inspections"
        subtitle="Shared field checklists — progress and cover photos at a glance."
      >
        <InspectionsListClient
          initialInspections={inspections}
          jobs={jobs}
          templates={templates}
          assignees={assignees.map((a) => ({ id: a.id, displayName: a.displayName }))}
          currentUserId={user.id}
          isAdmin={isAdminRole(user.profile.role)}
        />
      </InspectionsShell>
    </AppShell>
  );
}
