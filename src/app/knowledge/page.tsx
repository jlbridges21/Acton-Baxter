import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeListClient } from "@/components/admin/knowledge-list-client";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";
import { filterKnowledgeVisibleToUser } from "@/lib/knowledge/permissions";
import type { KnowledgeAnalytics } from "@/lib/knowledge/analytics";
import type { KnowledgeEntry } from "@/lib/knowledge/types";

function emptyAnalytics(entries: KnowledgeEntry[]): KnowledgeAnalytics {
  return {
    totals: {
      total: entries.length,
      approved: entries.filter((e) => e.status === "approved").length,
      drafts: entries.filter((e) => e.status === "draft").length,
      archived: entries.filter((e) => e.status === "archived").length,
      manual: 0,
      uploaded: 0,
      google: 0,
    },
    frequentlyCited: [],
    unusedApproved: [],
    recentlyImported: [],
    unansweredHints: [],
  };
}

/**
 * User-facing Knowledge Center — same shared shell/list as /admin/knowledge,
 * always with standard-user presentation (reduced sidebar + actions).
 * Data scope still uses filterKnowledgeVisibleToUser (admins see everything;
 * users see approved + own drafts).
 */
export default async function KnowledgeBrowsePage() {
  const user = await requireActiveUser();

  let entries: KnowledgeEntry[] = [];
  let loadError: string | null = null;
  try {
    const all = await listKnowledgeEntries({ sort: "updated" });
    entries = filterKnowledgeVisibleToUser(all, user.id, user.profile.role);
  } catch (error) {
    console.error("[knowledge] failed to list entries", error);
    loadError = "Knowledge Center could not be loaded. Please try again shortly.";
  }

  const analytics = emptyAnalytics(entries);

  return (
    <AppShell user={user}>
      {loadError ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      ) : null}
      <Suspense fallback={<div className="text-sm text-[var(--acton-muted)]">Loading…</div>}>
        <KnowledgeListClient
          initialEntries={entries}
          analytics={analytics}
          isAdmin={false}
          basePath="/knowledge"
          newEntryHref="/knowledge/new"
        />
      </Suspense>
    </AppShell>
  );
}
