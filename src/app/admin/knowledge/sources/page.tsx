import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeSourcesClient } from "@/components/admin/knowledge-sources-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeSources } from "@/lib/knowledge/queries";

export default async function KnowledgeSourcesPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const sources = await listKnowledgeSources();
  return (
    <AppShell user={user}>
      <KnowledgeSourcesClient initialSources={sources} />
    </AppShell>
  );
}
