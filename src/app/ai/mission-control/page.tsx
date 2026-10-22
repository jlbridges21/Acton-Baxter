import type { Metadata } from "next";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { MissionControl } from "@/components/ai/mission-control";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { getDepartmentRows } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mission Control" };

export default async function MissionControlPage() {
  const user = await requireActiveUser();
  let departments: Array<{ id: string; name: string }> | null = null;
  let loadError: unknown = null;
  try {
    departments = (await getDepartmentRows()).map((d) => ({ id: d.id, name: d.name }));
  } catch (error) {
    loadError = error;
  }
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Mission Control"
        description="Health, activity, and estimated cost across the AI organization. Figures include only tasks you're allowed to review."
      />
      {departments ? (
        <MissionControl departments={departments} />
      ) : (
        <AiLoadError error={loadError} context="MissionControlPage" />
      )}
    </AiPageShell>
  );
}
