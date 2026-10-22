import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { PageHeader } from "@/components/ai/ui";
import { WorkspaceSettingsForm } from "@/components/ai/workspace-settings";
import { requireActiveUser } from "@/lib/auth/session";
import { getWorkspaceSettings } from "@/lib/agents/admin";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";
import { getDepartmentRows } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customize AI Office" };

async function load() {
  const [settings, departments] = await Promise.all([getWorkspaceSettings(), getDepartmentRows()]);
  return { settings, departments };
}

export default async function WorkspaceSettingsPage() {
  const user = await requireActiveUser();
  if (!canAdministerWorkspace(requesterFromAuthUser(user))) redirect("/ai");
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
        title="Customize the AI Office"
        description="Layouts, themes, room names, and departments. Move an agent's desk from its profile (Overview tab)."
      />
      {data ? (
        <WorkspaceSettingsForm
          initialSettings={data.settings}
          initialDepartments={data.departments}
        />
      ) : (
        <AiLoadError error={loadError} context="WorkspaceSettingsPage" />
      )}
    </AiPageShell>
  );
}
