"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";

type PreviewRow = {
  filename: string;
  title: string;
  mimeType: string;
  extension: string;
  extractionStatus: string;
  warnings: string[];
  wordCount: number;
  characterCount: number;
  sizeBytes: number;
  previewText?: string;
  truncatedPreview?: boolean;
  duplicateEntryId: string | null;
  contentHash: string;
};

export function KnowledgeUploadClient() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"draft" | "approved">("draft");
  const [category, setCategory] = useState("General");
  const [tags, setTags] = useState("uploaded");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imported, setImported] = useState<Array<{ filename: string; entryId: string }>>([]);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  function onPick(fileList: FileList | null) {
    if (!fileList) return;
    const next = [...files, ...Array.from(fileList)];
    setFiles(next);
    setPreviews([]);
    setImported([]);
    setMessage(null);
    setError(null);
  }

  async function runPreview() {
    if (files.length === 0) return;
    setBusy(true);
    setPhase("Reading files…");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("action", "preview");
      for (const file of files) form.append("files", file);
      setPhase("Parsing…");
      const response = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Preview failed");
      const rows = (payload.previews ?? []) as PreviewRow[];
      setPreviews(rows);
      const nextTitles: Record<string, string> = {};
      for (const row of rows) nextTitles[row.filename] = row.title;
      setTitles(nextTitles);
      setPhase(null);
      setMessage(`Preview ready for ${rows.length} file(s). Review warnings, then import.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (files.length === 0) return;
    setBusy(true);
    setPhase("Importing into Knowledge…");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("action", "import");
      form.set("status", status);
      form.set("category", category);
      form.set("tags", tags);
      form.set("titles", JSON.stringify(titles));
      const hasEmpty = previews.some(
        (row) => row.extractionStatus === "empty" || row.characterCount === 0,
      );
      if (hasEmpty) form.set("allowEmpty", "true");
      for (const file of files) form.append("files", file);
      const response = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Import failed");
      const results = (payload.results ?? []) as Array<{ filename: string; entryId: string }>;
      setImported(results);
      setPhase("Finished.");
      setMessage(`Imported ${results.length} file(s) as ${status}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KnowledgeCenterShell
      title="Upload files"
      subtitle="Drag and drop, preview extracted text, then approve into the Knowledge Base."
      activeView="uploads"
      hideTopActions
    >
      <div className="space-y-6">
        {phase ? (
          <Card className="border-sky-200 bg-sky-50/60">
            <CardTitle className="text-base">{phase}</CardTitle>
            <CardDescription className="mt-1">
              Stay on this page until the step finishes.
            </CardDescription>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Select files</CardTitle>
          <CardDescription className="mt-2">
            Drag and drop or use the file picker. Preview extracted text before importing.
          </CardDescription>
          <div
            className="mt-4 rounded-md border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-8 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onPick(event.dataTransfer.files);
            }}
          >
            <p className="text-sm text-[var(--acton-muted)]">Drop files here</p>
            <label className="mt-3 inline-flex cursor-pointer items-center rounded-md bg-[var(--acton-navy)] px-4 py-2 text-sm font-semibold text-white">
              Choose files
              <input
                type="file"
                className="sr-only"
                multiple
                accept=".md,.markdown,.txt,.pdf,.docx,.csv,.xlsx"
                onChange={(event) => onPick(event.target.files)}
              />
            </label>
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              {files.length} file(s) · {(totalBytes / (1024 * 1024)).toFixed(2)} MB selected
            </p>
          </div>
          {files.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm">
              {files.map((file) => (
                <li key={`${file.name}-${file.size}`} className="flex justify-between gap-2">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="text-red-700 underline"
                    onClick={() => {
                      setFiles((current) => current.filter((row) => row !== file));
                      setPreviews((current) => current.filter((row) => row.filename !== file.name));
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => void runPreview()}
            >
              Preview extraction
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || files.length === 0}
              onClick={() => {
                setFiles([]);
                setPreviews([]);
                setImported([]);
              }}
            >
              Clear
            </Button>
          </div>
        </Card>

        {previews.length > 0 ? (
          <Card>
            <CardTitle>Import options</CardTitle>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="importStatus">
                  Status for all
                </label>
                <select
                  id="importStatus"
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as "draft" | "approved")}
                >
                  <option value="draft">Save as draft</option>
                  <option value="approved">Approve and publish</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="importCategory">
                  Category for all
                </label>
                <select
                  id="importCategory"
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {KNOWLEDGE_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="importTags">
                  Tags for all
                </label>
                <Input
                  id="importTags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button type="button" disabled={busy} onClick={() => void runImport()}>
                Import {previews.length} file(s)
              </Button>
            </div>
          </Card>
        ) : null}

        {previews.map((preview) => (
          <Card key={preview.contentHash + preview.filename}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{preview.filename}</CardTitle>
                <CardDescription className="mt-1">
                  {preview.extension.toUpperCase()} · {preview.extractionStatus} ·{" "}
                  {preview.wordCount} words · {preview.characterCount} chars
                </CardDescription>
              </div>
              {preview.duplicateEntryId ? (
                <Link
                  href={`/admin/knowledge/${preview.duplicateEntryId}`}
                  className="text-sm font-semibold text-amber-800 underline"
                >
                  Duplicate exists — open entry
                </Link>
              ) : null}
            </div>
            <div className="mt-3">
              <label
                className="mb-2 block text-sm font-semibold"
                htmlFor={`title-${preview.filename}`}
              >
                Title
              </label>
              <Input
                id={`title-${preview.filename}`}
                value={titles[preview.filename] ?? preview.title}
                onChange={(event) =>
                  setTitles((current) => ({ ...current, [preview.filename]: event.target.value }))
                }
              />
            </div>
            {preview.warnings.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap">
              {preview.previewText || "(No extractable text)"}
              {preview.truncatedPreview ? "\n\n[Preview truncated]" : ""}
            </pre>
          </Card>
        ))}

        {imported.length > 0 ? (
          <Card>
            <CardTitle>Imported</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {imported.map((row) => (
                <li key={row.entryId}>
                  {row.filename}{" "}
                  <Link className="underline" href={`/admin/knowledge/${row.entryId}`}>
                    Open entry
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm text-[var(--acton-navy)]">{message}</p> : null}
      </div>
    </KnowledgeCenterShell>
  );
}
