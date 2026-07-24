import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry, listKnowledgeEntryRevisions } from "@/lib/knowledge/queries";
import { formatDate, isUuid } from "@/lib/utils";

type PageProps = { params: Promise<{ id: string }> };

export default async function KnowledgeHistoryPage({ params }: PageProps) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();
  const revisions = await listKnowledgeEntryRevisions(id);

  return (
    <AppShell user={user}>
      <div className="space-y-4">
        <div>
          <Link
            href={`/admin/knowledge/${id}`}
            className="text-sm text-[var(--acton-navy)] underline"
          >
            ← Back to entry
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Revision history</h1>
          <p className="text-sm text-[var(--acton-muted)]">{entry.title}</p>
        </div>
        {revisions.length === 0 ? (
          <Card>
            <CardTitle>No revisions yet</CardTitle>
            <CardDescription className="mt-2">
              Revisions are created when an entry is edited.
            </CardDescription>
          </Card>
        ) : (
          revisions.map((revision) => (
            <Card key={revision.id}>
              <CardTitle>
                Version {revision.version} · {revision.status}
              </CardTitle>
              <CardDescription className="mt-2">
                {formatDate(revision.created_at)}
                {revision.change_note ? ` · ${revision.change_note}` : ""}
              </CardDescription>
              <p className="mt-3 text-sm font-semibold text-[var(--acton-navy)]">
                {revision.title}
              </p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap text-[var(--acton-navy)]">
                {revision.content}
              </pre>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
