import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { KnowledgeEntryForm } from "@/components/admin/knowledge-entry-form";
import { requireActiveUser } from "@/lib/auth/session";

export default async function NewUserKnowledgePage() {
  const user = await requireActiveUser();

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
          <KnowledgeEntryForm mode="create" variant="user" />
        </KnowledgeCenterShell>
      </Suspense>
    </AppShell>
  );
}
