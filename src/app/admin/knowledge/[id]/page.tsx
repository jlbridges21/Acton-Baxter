import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeEntryDetailClient } from "@/components/admin/knowledge-center/knowledge-entry-detail-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry, listKnowledgeEntryRevisions } from "@/lib/knowledge/queries";
import { countBaxterCitationsForEntry } from "@/lib/knowledge/store";
import { isUuid } from "@/lib/utils";

type PageProps = { params: Promise<{ id: string }> };

export default async function KnowledgeDetailPage({ params }: PageProps) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();

  const [revisions, citationCount] = await Promise.all([
    listKnowledgeEntryRevisions(id).catch(() => []),
    countBaxterCitationsForEntry(id).catch(() => 0),
  ]);

  return (
    <AppShell user={user}>
      <Suspense fallback={<div className="text-sm text-[var(--acton-muted)]">Loading…</div>}>
        <KnowledgeEntryDetailClient
          entry={entry}
          revisions={revisions}
          citationCount={citationCount}
        />
      </Suspense>
    </AppShell>
  );
}
