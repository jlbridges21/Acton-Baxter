"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import type { KnowledgeEntry } from "@/lib/knowledge/types";

export function KnowledgeEntryForm({
  mode,
  initial,
  variant = "admin",
}: {
  mode: "create" | "edit";
  initial?: KnowledgeEntry | null;
  /** User variant posts to /api/knowledge (draft-only) and omits approve. */
  variant?: "admin" | "user";
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [category, setCategory] = useState(initial?.category ?? "General");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [sourceName, setSourceName] = useState(initial?.source_name ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.source_url ?? "");
  const [visibility, setVisibility] = useState(initial?.visibility ?? "internal");
  const [changeNote, setChangeNote] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const wordCount = useMemo(() => {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content]);

  const showApprovedEditNotice = mode === "edit" && initial?.status === "approved";
  const isGoogleManaged =
    initial?.source_type === "Google Drive" ||
    Boolean((initial?.metadata as { googleManaged?: boolean } | undefined)?.googleManaged);

  async function submit(nextStatus?: "draft" | "approved") {
    setSubmitting(true);
    setError(null);
    try {
      const isUserVariant = variant === "user";
      const payload = {
        title,
        content,
        summary: summary || null,
        category: category || "General",
        tags,
        source_name: sourceName || (mode === "create" ? "Manual entry" : null),
        source_type: initial?.source_type ?? "manual",
        source_url: sourceUrl || null,
        visibility: isUserVariant ? "internal" : visibility,
        status: isUserVariant ? "draft" : nextStatus,
        change_note: changeNote || null,
      };
      const createUrl = isUserVariant ? "/api/knowledge" : "/api/admin/knowledge";
      const response = await fetch(
        mode === "create" ? createUrl : `/api/admin/knowledge/${initial!.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as {
        entry?: KnowledgeEntry;
        error?: { message?: string };
      };
      if (!response.ok || !body.entry) {
        throw new Error(body.error?.message ?? "Unable to save knowledge entry");
      }
      router.push(
        isUserVariant ? `/knowledge/${body.entry.id}` : `/admin/knowledge/${body.entry.id}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardTitle>{mode === "create" ? "New knowledge entry" : "Edit knowledge entry"}</CardTitle>
      <CardDescription className="mt-2">
        {variant === "user"
          ? "Submit a draft for admin review. Only approved entries are used by Baxter."
          : "Only a title and content are required. Everything else is optional."}
      </CardDescription>
      {showApprovedEditNotice ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Editing this approved entry will save the current version and return the update to draft
          for review.
        </p>
      ) : null}
      {isGoogleManaged ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Content is controlled by Google Drive. Prefer editing the original Google file, then sync.
          Tags and category can still be adjusted here.
        </p>
      ) : null}

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit("draft");
        }}
      >
        <div>
          <label
            className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            htmlFor="title"
          >
            Title <span className="text-red-600">*</span>
          </label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. How Acton ADU Builds ADUs"
          />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label
              className="block text-sm font-semibold text-[var(--acton-navy)]"
              htmlFor="content"
            >
              Content <span className="text-red-600">*</span>
            </label>
            <div className="flex items-center gap-2 text-xs text-[var(--acton-muted)]">
              <button
                type="button"
                className={tab === "write" ? "font-semibold text-[var(--acton-navy)]" : ""}
                onClick={() => setTab("write")}
              >
                Write
              </button>
              <span>·</span>
              <button
                type="button"
                className={tab === "preview" ? "font-semibold text-[var(--acton-navy)]" : ""}
                onClick={() => setTab("preview")}
              >
                Preview
              </button>
              <span aria-live="polite">
                {wordCount} words · {content.length} characters
              </span>
            </div>
          </div>
          {tab === "write" ? (
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={16}
              placeholder="Paste or write the procedure, policy, or notes Baxter should know…"
              className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 font-mono text-sm text-[var(--acton-navy)]"
            />
          ) : (
            <div className="min-h-64 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
              {content.trim() || "Nothing to preview yet."}
            </div>
          )}
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            Headings, bullets, numbered lists, links, and Markdown tables are supported as plain
            text.
          </p>
        </div>

        <div>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? "Hide advanced options" : "Advanced options"}
          </button>
          {advancedOpen ? (
            <div className="mt-3 space-y-4 rounded-md border border-[var(--acton-border)] p-4">
              <div>
                <label
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                  htmlFor="summary"
                >
                  Summary
                </label>
                <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                    htmlFor="category"
                  >
                    Category
                  </label>
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                  >
                    {KNOWLEDGE_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                    htmlFor="tags"
                  >
                    Tags (comma-separated)
                  </label>
                  <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                    htmlFor="sourceName"
                  >
                    Source name
                  </label>
                  <Input
                    id="sourceName"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                    htmlFor="visibility"
                  >
                    Who can use this
                  </label>
                  <select
                    id="visibility"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as "internal" | "admin_only")}
                    className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                  >
                    <option value="internal">All Acton employees</option>
                    <option value="admin_only">Administrators only</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                  htmlFor="sourceUrl"
                >
                  Source URL
                </label>
                <Input
                  id="sourceUrl"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </div>
              {mode === "edit" ? (
                <div>
                  <label
                    className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
                    htmlFor="changeNote"
                  >
                    Change note
                  </label>
                  <Input
                    id="changeNote"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : variant === "user" ? "Submit draft" : "Save as draft"}
          </Button>
          {variant === "admin" ? (
            <Button
              type="button"
              variant="accent"
              disabled={submitting}
              onClick={() => void submit("approved")}
            >
              Approve and publish
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
