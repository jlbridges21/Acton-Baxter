import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GhlConversationDetailClient } from "@/components/admin/ghl-conversation-detail-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";

export default async function AdminGhlConversationDetailPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  return (
    <AppShell user={user}>
      <GhlConversationDetailClient />
    </AppShell>
  );
}
