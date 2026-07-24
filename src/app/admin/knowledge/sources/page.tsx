import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeSourcesClient } from "@/components/admin/knowledge-sources-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeSources } from "@/lib/knowledge/queries";

export default async function KnowledgeSourcesPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  let sources: Awaited<ReturnType<typeof listKnowledgeSources>> = [];
  let loadError: string | null = null;
  try {
    sources = await listKnowledgeSources();
  } catch (error) {
    console.error("[admin/knowledge/sources] failed to list sources", error);
    loadError =
      "Knowledge sources could not be loaded. Confirm migration 006_knowledge_base.sql has been applied.";
  }

  return (
    <AppShell user={user}>
      {loadError ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      ) : null}
      <KnowledgeSourcesClient initialSources={sources} />
    </AppShell>
  );
}
