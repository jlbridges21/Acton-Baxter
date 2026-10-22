import type { Metadata } from "next";
import { Suspense } from "react";
import { AiPageShell } from "@/components/ai/ai-page";
import { KnowledgeHub } from "@/components/ai/knowledge-hub";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { canAdministerWorkspace, requesterFromAuthUser } from "@/lib/agents/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Knowledge Hub" };

export default async function KnowledgeHubPage() {
  const user = await requireActiveUser();
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Knowledge Hub"
        description="Approved documents that specialist agents like Sam use to answer questions. These are kept separate from Baxter's general Knowledge Center, so HR material is only used by the agents you assign it to."
      />
      <Suspense>
        <KnowledgeHub isAdmin={canAdministerWorkspace(requesterFromAuthUser(user))} />
      </Suspense>
    </AiPageShell>
  );
}
