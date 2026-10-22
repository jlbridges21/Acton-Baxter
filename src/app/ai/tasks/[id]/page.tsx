import type { Metadata } from "next";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { TaskDetail } from "@/components/ai/tasks";
import { requireActiveUser } from "@/lib/auth/session";
import { listResolvedAgents } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  const { id } = await params;
  let agents: Array<{
    id: string;
    slug: string;
    name: string;
    avatarUrl: string | null;
    departmentColor: string | null;
  }> | null = null;
  let loadError: unknown = null;
  try {
    agents = (await listResolvedAgents()).map((a) => ({
      id: a.row.id,
      slug: a.row.slug,
      name: a.row.display_name,
      avatarUrl: a.row.avatar_url,
      departmentColor: a.department?.color ?? null,
    }));
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      {agents ? (
        <TaskDetail id={id} agents={agents} />
      ) : (
        <AiLoadError error={loadError} context="TaskPage" />
      )}
    </AiPageShell>
  );
}
