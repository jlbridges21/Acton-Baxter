import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { PageHeader } from "@/components/ai/ui";
import { WorkspaceSettingsForm } from "@/components/ai/workspace-settings";
import { requireActiveUser } from "@/lib/auth/session";
import { getWorkspaceSettings } from "@/lib/agents/admin";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";
import { getDepartmentRows } from "@/lib/agents/registry";
import { listAgentCards } from "@/lib/agents/views";
import { normalizeAnimationSettings } from "@/lib/office/animation-settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customize AI Office" };

async function load(requester: ReturnType<typeof requesterFromAuthUser>) {
  const [settings, departments, agents] = await Promise.all([
    getWorkspaceSettings(),
    getDepartmentRows(),
    listAgentCards(requester),
  ]);
  return {
    settings,
    departments,
    animation: normalizeAnimationSettings(settings.animation_settings),
    agents: agents
      .filter((a) => a.status !== "archived")
      .map((a) => ({ id: a.id, name: a.name, title: a.title, kind: a.kind })),
  };
}

export default async function WorkspaceSettingsPage() {
  const user = await requireActiveUser();
  const requester = requesterFromAuthUser(user);
  if (!canAdministerWorkspace(requester)) redirect("/ai");
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
        title="Customize the AI Office"
        description="Layouts, themes, room names, departments, and how the office characters move. Move an agent's desk from its profile (Overview tab)."
      />
      {data ? (
        <WorkspaceSettingsForm
          initialSettings={data.settings}
          initialDepartments={data.departments}
          initialAnimation={data.animation}
          agents={data.agents}
        />
      ) : (
        <AiLoadError error={loadError} context="WorkspaceSettingsPage" />
      )}
    </AiPageShell>
  );
}
