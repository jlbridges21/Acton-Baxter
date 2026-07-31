import { AppShell } from "@/components/layout/app-shell";
import { ProjectSetupClient } from "@/components/projects/project-setup-client";
import { requireActiveUser } from "@/lib/auth/session";

export default async function ProjectSetupPage() {
  const user = await requireActiveUser();
  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">New project setup</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Search GoHighLevel for the customer, confirm details, and run a dry-run setup plan. No
          Drive, Sheets, Slack, or GHL changes are made yet.
        </p>
      </div>
      <ProjectSetupClient />
    </AppShell>
  );
}
