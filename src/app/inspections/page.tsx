import { AppShell } from "@/components/layout/app-shell";
import { InspectionsPageClient } from "@/components/inspections/inspections-page-client";
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
      <InspectionsPageClient
        initialInspections={inspections}
        jobs={jobs}
        templates={templates}
        assignees={assignees.map((a) => ({ id: a.id, displayName: a.displayName }))}
        currentUserId={user.id}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
