import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { requireActiveUser } from "@/lib/auth/session";
import { getKnowledgeEntry } from "@/lib/knowledge/queries";

export default async function KnowledgeEntryPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireActiveUser();
  const { id } = await params;
  const entry = await getKnowledgeEntry(id);
  if (!entry) notFound();
  if (entry.status !== "approved" || entry.visibility !== "internal") {
    redirect("/");
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/" className="text-sm text-[var(--acton-muted)] hover:underline">
          ← Baxter Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">{entry.title}</h1>
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
                Open original source
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
      </div>
    </AppShell>
  );
}
