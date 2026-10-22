import type { Metadata } from "next";
import { Suspense } from "react";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { TaskList } from "@/components/ai/tasks";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { listResolvedAgents } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Tasks" };

async function loadAgentLites() {
  return (await listResolvedAgents()).map((a) => ({
    id: a.row.id,
    slug: a.row.slug,
    name: a.row.display_name,
    avatarUrl: a.row.avatar_url,
    departmentColor: a.department?.color ?? null,
  }));
}

export default async function TasksPage() {
  const user = await requireActiveUser();
  let agents: Awaited<ReturnType<typeof loadAgentLites>> | null = null;
  let loadError: unknown = null;
  try {
    agents = await loadAgentLites();
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Tasks"
        description="Assignments handled by AI agents: who asked, who did the work, what happened, and the result."
      />
      {agents ? (
        <Suspense>
          <TaskList agents={agents} />
        </Suspense>
      ) : (
        <AiLoadError error={loadError} context="TasksPage" />
      )}
    </AiPageShell>
  );
}
