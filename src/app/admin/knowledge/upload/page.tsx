import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeUploadClient } from "@/components/admin/knowledge-upload-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";

export default async function AdminKnowledgeUploadPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  return (
    <AppShell user={user}>
      <KnowledgeUploadClient />
    </AppShell>
  );
}
