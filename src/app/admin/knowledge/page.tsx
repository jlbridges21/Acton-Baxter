import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeListClient } from "@/components/admin/knowledge-list-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";

export default async function AdminKnowledgePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  let entries: Awaited<ReturnType<typeof listKnowledgeEntries>> = [];
  let loadError: string | null = null;
  try {
    entries = await listKnowledgeEntries({ sort: "updated" });
  } catch (error) {
    console.error("[admin/knowledge] failed to list entries", error);
    loadError =
      "Knowledge Base could not be loaded. Confirm migration 006_knowledge_base.sql has been applied in Supabase.";
  }

  return (
    <AppShell user={user}>
      {loadError ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      ) : null}
      <KnowledgeListClient initialEntries={entries} />
    </AppShell>
  );
}
