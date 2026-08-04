import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry } from "@/lib/knowledge/queries";
import { canUserReadKnowledgeEntry } from "@/lib/knowledge/permissions";

export default async function KnowledgeEntryPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireActiveUser();
  const { id } = await params;
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();
  if (!canUserReadKnowledgeEntry(entry, user.id, user.profile.role)) {
    redirect("/knowledge");
  }

  return (
    <AppShell user={user}>
      <Suspense fallback={<div className="text-sm text-[var(--acton-muted)]">Loading…</div>}>
        <KnowledgeCenterShell
          subtitle="Browse approved Acton knowledge and submit drafts for admin review."
          isAdmin={false}
          basePath="/knowledge"
          newEntryHref="/knowledge/new"
          hideTopActions={false}
        >
          <Card className="space-y-4 p-5">
            <Link href="/knowledge" className="text-sm text-[var(--acton-muted)] hover:underline">
              ← Knowledge Center
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[var(--acton-navy)]">{entry.title}</h2>
              <Badge tone={entry.status === "approved" ? "green" : "amber"}>{entry.status}</Badge>
            </div>
            {entry.status === "draft" ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                This is your draft. An admin must approve it before Baxter can use it in answers.
              </p>
            ) : null}
            <p className="text-sm text-[var(--acton-muted)]">
              {entry.category}
              {entry.source_name ? ` · ${entry.source_name}` : ""}
              {entry.source_url ? (
                <>
                  {" · "}
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                  >
                    {entry.source_type === "Google Drive"
                      ? "Open in Google"
                      : "Open original source"}
                  </a>
                </>
              ) : null}
            </p>
            {entry.summary ? (
              <p className="rounded-md bg-[var(--acton-gray-50)] p-3 text-sm text-[var(--acton-navy)]">
                {entry.summary}
              </p>
            ) : null}
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
              {entry.content}
            </div>
          </Card>
        </KnowledgeCenterShell>
      </Suspense>
    </AppShell>
  );
}
