import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry } from "@/lib/knowledge/queries";
import { formatDate, isUuid } from "@/lib/utils";

type PageProps = { params: Promise<{ id: string }> };

export default async function KnowledgeDetailPage({ params }: PageProps) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();

  return (
    <AppShell user={user}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{entry.title}</h1>
              <Badge
                tone={
                  entry.status === "approved"
                    ? "green"
                    : entry.status === "archived"
                      ? "gray"
                      : "amber"
                }
              >
                {entry.status}
              </Badge>
              <Badge tone="navy">v{entry.version}</Badge>
              {entry.source_type === "Google Drive" || entry.metadata?.googleManaged === true ? (
                <Badge tone="amber">Google Workspace managed</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              {entry.category}
              {entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}
            </p>
            {entry.source_type === "Google Drive" ? (
              <p className="mt-2 text-sm text-amber-800">
                Content is controlled by Google Drive. Edit the original Google file, then sync.
                Tags/category metadata may be edited in Baxter without being overwritten
                unexpectedly.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {entry.source_type === "Google Drive" ? (
              <Link
                href="/admin/connectors/google"
                className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
              >
                Manage source
              </Link>
            ) : null}
            <Link
              href={`/admin/knowledge/${entry.id}/edit`}
              className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
            >
              {entry.source_type === "Google Drive" ? "Edit metadata" : "Edit"}
            </Link>
            <Link
              href={`/admin/knowledge/${entry.id}/history`}
              className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
            >
              Revision history
            </Link>
          </div>
        </div>

        <Card>
          <CardTitle>Summary</CardTitle>
          <CardDescription className="mt-2 whitespace-pre-wrap">
            {entry.summary || "No summary provided."}
          </CardDescription>
        </Card>

        <Card>
          <CardTitle>Content</CardTitle>
          <div className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
            {entry.content}
          </div>
        </Card>

        <Card>
          <CardTitle>Source & audit</CardTitle>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-[var(--acton-navy)]">Source</dt>
              <dd className="text-[var(--acton-muted)]">
                {entry.source_name || "—"} ({entry.source_type})
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--acton-navy)]">Visibility</dt>
              <dd className="text-[var(--acton-muted)]">{entry.visibility}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--acton-navy)]">Updated</dt>
              <dd className="text-[var(--acton-muted)]">{formatDate(entry.updated_at)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--acton-navy)]">Approved</dt>
              <dd className="text-[var(--acton-muted)]">{formatDate(entry.approved_at)}</dd>
            </div>
            {entry.source_url ? (
              <div className="sm:col-span-2">
                <dt className="font-semibold text-[var(--acton-navy)]">Source URL</dt>
                <dd>
                  <a
                    href={entry.source_url}
                    className="text-[var(--acton-navy)] underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.source_url}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>
    </AppShell>
  );
}
