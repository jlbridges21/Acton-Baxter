import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KnowledgeListClient } from "@/components/admin/knowledge-list-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/queries";
import { getKnowledgeAnalytics } from "@/lib/knowledge/analytics";
import { getGoogleAdminOverview } from "@/lib/connectors/google/diagnostics";

export default async function AdminKnowledgePage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  let entries: Awaited<ReturnType<typeof listKnowledgeEntries>> = [];
  let loadError: string | null = null;
  try {
    entries = await listKnowledgeEntries({ sort: "updated" });
  } catch (error) {
    console.error("[admin/knowledge] failed to list entries", error);
    loadError =
      "Knowledge Base could not be loaded. Confirm migration 006_knowledge_base.sql has been applied in Supabase.";
  }

  const analytics = await getKnowledgeAnalytics().catch(() => ({
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
  }));

  let connectorLabel = "Not checked";
  let connectorDetails = "";
  try {
    const overview = await getGoogleAdminOverview();
    connectorLabel = overview.managerHealth.label;
    connectorDetails = overview.managerHealth.details;
  } catch {
    connectorLabel = "Unavailable";
  }

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
          connectorLabel={connectorLabel}
          connectorDetails={connectorDetails}
          isAdmin
          basePath="/admin/knowledge"
          newEntryHref="/admin/knowledge/new"
        />
      </Suspense>
    </AppShell>
  );
}
