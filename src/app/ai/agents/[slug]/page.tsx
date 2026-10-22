import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AiLoadError, AiPageShell } from "@/components/ai/ai-page";
import { AgentStudio } from "@/components/ai/agent-studio";
import { requireActiveUser } from "@/lib/auth/session";
import { getDepartmentRows, getResolvedAgent, listResolvedAgents } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent Studio" };

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const [agent, departments, agents] = await Promise.all([
    getResolvedAgent(slug, { fresh: true }),
    getDepartmentRows(),
    listResolvedAgents(),
  ]);
  return { agent, departments, agents };
}

export default async function AgentStudioPage({ params }: Props) {
  const user = await requireActiveUser();
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof load>> | null = null;
  let loadError: unknown = null;
  try {
    data = await load(slug);
  } catch (error) {
    loadError = error;
  }
  if (data && !data.agent) notFound();
  return (
    <AiPageShell user={user}>
      {data ? (
        <Suspense>
          <AgentStudio
            slug={slug}
            departments={data.departments.map((d) => ({ id: d.id, slug: d.slug, name: d.name }))}
            agents={data.agents
              .filter((a) => a.row.status !== "archived")
              .map((a) => ({ id: a.row.id, name: a.row.display_name }))}
          />
        </Suspense>
      ) : (
        <AiLoadError error={loadError} context="AgentStudioPage" />
      )}
    </AiPageShell>
  );
}
