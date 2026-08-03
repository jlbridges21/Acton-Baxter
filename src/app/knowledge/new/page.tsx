import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeEntryForm } from "@/components/admin/knowledge-entry-form";
import { requireActiveUser } from "@/lib/auth/session";

export default async function NewUserKnowledgePage() {
  const user = await requireActiveUser();
  return (
    <AppShell user={user}>
      <KnowledgeEntryForm mode="create" variant="user" />
    </AppShell>
  );
}
