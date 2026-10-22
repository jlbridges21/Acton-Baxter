import type { Metadata } from "next";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { AiOffice } from "@/components/ai/office";
import Link from "next/link";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { getWorkspaceSettings } from "@/lib/agents/admin";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";
import { getDepartmentRows } from "@/lib/agents/registry";
import { listRuntimeStatuses } from "@/lib/agents/tasks";
import { taskSummary } from "@/lib/agents/task-format";
import { listAgentCards, listVisibleTasks } from "@/lib/agents/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Office" };

async function load(requester: ReturnType<typeof requesterFromAuthUser>) {
  const [agents, departments, settings, statuses, recent] = await Promise.all([
    listAgentCards(requester),
    getDepartmentRows(),
    getWorkspaceSettings(),
    listRuntimeStatuses(),
    listVisibleTasks(requester, { limit: 12 }),
  ]);
  return {
    agents,
    departments,
    settings,
    status: {
      statuses: statuses.map((s) => ({
        agentId: s.agent_id,
        state: s.state,
        activeTaskCount: s.active_task_count,
        lastCompletedAt: s.last_completed_at,
        updatedAt: s.updated_at,
      })),
      recent: recent.map(taskSummary),
      serverTime: new Date().toISOString(),
    },
  };
}

export default async function AiOfficePage() {
  const user = await requireActiveUser();
  const requester = requesterFromAuthUser(user);
  let data: Awaited<ReturnType<typeof load>> | null = null;
  let loadError: unknown = null;
  try {
    data = await load(requester);
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="AI Office"
        description="Acton ADU's AI organization at work. Baxter (AI CEO) answers employees and hands specialist work to agents like Sam. Activity shown here comes from real task records."
        actions={
          canAdministerWorkspace(requester) ? (
            <Link
              href="/ai/workspace"
              className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
            >
              Customize office
            </Link>
          ) : null
        }
      />
      {data ? (
        <AiOffice
          initialAgents={data.agents}
          departments={data.departments}
          settings={data.settings}
          canAdminister={canAdministerWorkspace(requester)}
          initialStatus={data.status}
        />
      ) : (
        <AiLoadError error={loadError} context="AiOfficePage" />
      )}
    </AiPageShell>
  );
}
