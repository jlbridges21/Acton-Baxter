import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeEntryForm } from "@/components/admin/knowledge-entry-form";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry } from "@/lib/knowledge/queries";
import { isUuid } from "@/lib/utils";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditKnowledgePage({ params }: PageProps) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();
  return (
    <AppShell user={user}>
      <KnowledgeEntryForm mode="edit" initial={entry} />
    </AppShell>
  );
}
