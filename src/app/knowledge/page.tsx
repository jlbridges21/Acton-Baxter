import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeBrowseClient } from "@/components/knowledge/knowledge-browse-client";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";
import { filterKnowledgeVisibleToUser } from "@/lib/knowledge/permissions";

export default async function KnowledgeBrowsePage() {
  const user = await requireActiveUser();
  let entries: Awaited<ReturnType<typeof listKnowledgeEntries>> = [];
  try {
    const all = await listKnowledgeEntries({ sort: "updated" });
    entries = filterKnowledgeVisibleToUser(all, user.id, user.profile.role);
  } catch (error) {
    console.error("[knowledge] failed to list entries", error);
  }

  return (
    <AppShell user={user}>
      <KnowledgeBrowseClient initialEntries={entries} currentUserId={user.id} />
    </AppShell>
  );
}
