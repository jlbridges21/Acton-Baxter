import { AppShell } from "@/components/layout/app-shell";
import { ProjectSetupRunClient } from "@/components/projects/project-setup-run-client";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getProjectSetupRun } from "@/lib/project-setup/store";

export default async function ProjectSetupRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const user = await requireActiveUser();
  const { runId } = await params;
  const run = await getProjectSetupRun(runId).catch(() => null);
  const isAdmin = isAdminRole(user.profile.role);
  const canRetry = !run || isAdmin || run.initiatedBy === user.id || run.status !== "failed";

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Project setup run</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Live checklist for this run. Completed steps are skipped on retry.
        </p>
      </div>
      <ProjectSetupRunClient runId={runId} canRetry={canRetry} isAdmin={isAdmin} />
    </AppShell>
  );
}
