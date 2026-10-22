import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { AgentWizard } from "@/components/ai/agent-wizard";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { KNOWLEDGE_CATEGORIES } from "@/lib/agents/defaults";
import { getProviderStatuses, MODEL_CATALOG } from "@/lib/agents/models";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";
import { getDepartmentRows, listResolvedAgents } from "@/lib/agents/registry";
import { TOOL_REGISTRY } from "@/lib/agents/tools";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New agent" };

async function load() {
  const [departments, agents] = await Promise.all([getDepartmentRows(), listResolvedAgents()]);
  return { departments, agents };
}

export default async function NewAgentPage() {
  const user = await requireActiveUser();
  if (!canAdministerWorkspace(requesterFromAuthUser(user))) redirect("/ai/agents");
  let data: Awaited<ReturnType<typeof load>> | null = null;
  let loadError: unknown = null;
  try {
    data = await load();
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="New agent"
        description="Add an AI agent from the tools the platform already supports. New integrations (for example BambooHR or email sending) need engineering work before they appear here."
      />
      {data ? (
        <AgentWizard
          departments={data.departments.map((d) => ({ id: d.id, name: d.name }))}
          agents={data.agents
            .filter((a) => a.row.status === "active")
            .map((a) => ({ id: a.row.id, name: a.row.display_name, kind: a.row.kind }))}
          models={MODEL_CATALOG}
          providers={getProviderStatuses()}
          categories={KNOWLEDGE_CATEGORIES}
          tools={TOOL_REGISTRY.map((t) => ({
            key: t.key,
            label: t.label,
            description: t.description,
            risk: t.risk,
            alwaysRequiresApproval: t.alwaysRequiresApproval,
            available: t.available,
            unavailableReason: t.unavailableReason ?? null,
          }))}
        />
      ) : (
        <AiLoadError error={loadError} context="NewAgentPage" />
      )}
    </AiPageShell>
  );
}
