import { AppShell } from "@/components/layout/app-shell";
import { ProjectSetupClient } from "@/components/projects/project-setup-client";
import { requireActiveUser } from "@/lib/auth/session";
import { googleWritesEnabled } from "@/lib/project-setup/capabilities";

export default async function ProjectSetupPage() {
  const user = await requireActiveUser();
  const writesEnabled = await googleWritesEnabled().catch(() => false);
  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">New project setup</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          {writesEnabled
            ? "Search GoHighLevel for the customer, confirm details, and create the Master Project Log row, Drive folder, and charter. Slack channel steps remain dry-run until Prompt 3."
            : "Search GoHighLevel for the customer and confirm details. Google writes are not enabled yet — reconnect Google Workspace with write scopes, or run as a dry-run plan."}
        </p>
      </div>
      <ProjectSetupClient googleWritesEnabled={writesEnabled} />
    </AppShell>
  );
}
