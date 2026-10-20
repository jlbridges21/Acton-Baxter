import { AppShell } from "@/components/layout/app-shell";
import { InspectionsPageClient } from "@/components/inspections/inspections-page-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listGovernanceOwnerCandidates } from "@/lib/baxter-ai/governance/owner-candidates";
import { listSiteInspections, listTemplates } from "@/lib/inspections";
import { listExpenseJobs, splitPickerJobs } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export default async function InspectionsPage() {
  const user = await requireActiveUser();
  const [inspections, allJobs, templates, assignees] = await Promise.all([
    listSiteInspections(),
    listExpenseJobs({ includeInactive: true }),
    listTemplates({ includeArchived: true }),
    listGovernanceOwnerCandidates(),
  ]);
  // Pickers offer Open projects only; inspections on a Closed project keep their label.
  const { pickable: jobs, linkedLabels } = splitPickerJobs(
    allJobs,
    inspections.map((inspection) => inspection.jobId),
  );

  return (
    <AppShell user={user}>
      <InspectionsPageClient
        initialInspections={inspections}
        jobs={jobs}
        linkedJobLabels={linkedLabels}
        templates={templates}
        assignees={assignees.map((a) => ({ id: a.id, displayName: a.displayName }))}
        currentUserId={user.id}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
