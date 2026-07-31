import { AppShell } from "@/components/layout/app-shell";
import { ProjectSetupRunClient } from "@/components/projects/project-setup-run-client";
import { requireActiveUser } from "@/lib/auth/session";

export default async function ProjectSetupRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const user = await requireActiveUser();
  const { runId } = await params;

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Project setup run</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Live checklist for this dry-run. Completed steps are skipped on retry.
        </p>
      </div>
      <ProjectSetupRunClient runId={runId} />
    </AppShell>
  );
}
