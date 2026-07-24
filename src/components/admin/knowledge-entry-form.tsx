"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { KNOWLEDGE_SOURCE_TYPES, type KnowledgeEntry } from "@/lib/knowledge/types";

export function KnowledgeEntryForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: KnowledgeEntry | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [category, setCategory] = useState(initial?.category ?? KNOWLEDGE_CATEGORIES[0]);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [sourceName, setSourceName] = useState(initial?.source_name ?? "");
  const [sourceType, setSourceType] = useState(initial?.source_type ?? "manual");
  const [sourceUrl, setSourceUrl] = useState(initial?.source_url ?? "");
  const [visibility, setVisibility] = useState(initial?.visibility ?? "internal");
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(nextStatus?: "draft" | "approved") {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        title,
        content,
        summary: summary || null,
        category,
        tags,
        source_name: sourceName || null,
        source_type: sourceType,
        source_url: sourceUrl || null,
        visibility,
        status: nextStatus,
        change_note: changeNote || null,
      };
      const response = await fetch(
        mode === "create" ? "/api/admin/knowledge" : `/api/admin/knowledge/${initial!.id}`,
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
      router.push(`/admin/knowledge/${body.entry.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardTitle>{mode === "create" ? "Add knowledge entry" : "Edit knowledge entry"}</CardTitle>
      <CardDescription className="mt-2">
        Editing approved content saves a revision and returns the entry to draft so it must be
        approved again before Baxter can use it.
      </CardDescription>

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
            Title
          </label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label
            className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            htmlFor="summary"
          >
            Summary
          </label>
          <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div>
          <label
            className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            htmlFor="content"
          >
            Content
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={14}
            className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm text-[var(--acton-navy)]"
          />
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
              htmlFor="sourceType"
            >
              Source type
            </label>
            <select
              id="sourceType"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
              className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            >
              {KNOWLEDGE_SOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <div>
            <label
              className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
              htmlFor="visibility"
            >
              Visibility
            </label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "internal" | "admin_only")}
              className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
            >
              <option value="internal">internal</option>
              <option value="admin_only">admin_only</option>
            </select>
          </div>
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
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save as Draft"}
          </Button>
          <Button
            type="button"
            variant="accent"
            disabled={submitting}
            onClick={() => void submit("approved")}
          >
            Save & Approve
          </Button>
        </div>
      </form>
    </Card>
  );
}
