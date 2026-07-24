import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeListClient } from "@/components/admin/knowledge-list-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";

export default async function AdminKnowledgePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const entries = await listKnowledgeEntries({ sort: "updated" });
  return (
    <AppShell user={user}>
      <KnowledgeListClient initialEntries={entries} />
    </AppShell>
  );
}
