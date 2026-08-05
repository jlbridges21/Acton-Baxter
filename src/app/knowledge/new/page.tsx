import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { UserKnowledgeCreateClient } from "@/components/knowledge/user-knowledge-create-client";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";

export default async function NewUserKnowledgePage() {
  const user = await requireActiveUser();
  if (isAdminRole(user.profile.role)) redirect("/admin/knowledge/new");

  return (
    <AppShell user={user}>
      <Suspense fallback={<div className="text-sm text-[var(--acton-muted)]">Loading…</div>}>
        <KnowledgeCenterShell
          title="Add knowledge"
          subtitle="Submit a draft for admin review. Baxter will not use it until it is approved."
          activeView="new"
          isAdmin={false}
          basePath="/knowledge"
          newEntryHref="/knowledge/new"
          hideTopActions
        >
          <UserKnowledgeCreateClient />
        </KnowledgeCenterShell>
      </Suspense>
    </AppShell>
  );
}
