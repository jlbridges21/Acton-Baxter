import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeEntryForm } from "@/components/admin/knowledge-entry-form";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";

export default async function NewKnowledgePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  return (
    <AppShell user={user}>
      <KnowledgeEntryForm mode="create" />
    </AppShell>
  );
}
