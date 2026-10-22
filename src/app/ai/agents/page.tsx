import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { AgentDirectory } from "@/components/ai/agent-directory";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";
import { listAgentCards, type AgentCard } from "@/lib/agents/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Agents" };

export default async function AgentsPage() {
  const user = await requireActiveUser();
  const requester = requesterFromAuthUser(user);
  const isAdmin = canAdministerWorkspace(requester);
  let agents: AgentCard[] | null = null;
  let loadError: unknown = null;
  try {
    agents = await listAgentCards(requester, { includeArchived: isAdmin });
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Agents"
        description="Every AI agent in Acton ADU's organization, who they report to, and what they're doing. Open an agent to see or change how it works."
        actions={
          isAdmin ? (
            <Link
              href="/ai/agents/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
            >
              <Plus className="h-4 w-4" /> New agent
            </Link>
          ) : null
        }
      />
      {agents ? (
        <AgentDirectory agents={agents} isAdmin={isAdmin} />
      ) : (
        <AiLoadError error={loadError} context="AgentsPage" />
      )}
    </AiPageShell>
  );
}
