"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KnowledgeCenterShell } from "@/components/admin/knowledge-center/knowledge-center-shell";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { SUPPORTED_JURISDICTIONS, type KnowledgeDocKind } from "@/lib/jurisdictions";

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
  metadata?: {
    errorCode?: string | null;
    extractionMethod?: string | null;
    scannedOrImageOnly?: boolean;
  };
};

function previewHeadline(preview: PreviewRow): {
  title: string;
  detail: string;
  tone: "ok" | "warn" | "error";
} {
  if (preview.extractionStatus === "failed") {
    const code = preview.metadata?.errorCode;
    if (code === "PDF_PASSWORD_PROTECTED") {
      return {
        title: "Password-protected PDF",
        detail: preview.warnings[0] ?? "Upload an unlocked copy to add it to Baxter.",
        tone: "error",
      };
    }
    if (code === "PDF_INVALID") {
      return {
        title: "Invalid PDF",
        detail: preview.warnings[0] ?? "Baxter couldn't read this file.",
        tone: "error",
      };
    }
    return {
      title: "Could not process PDF",
      detail:
        preview.warnings[0] ??
        "Baxter couldn't read this PDF. Please try again or upload another copy.",
      tone: "error",
    };
  }
  if (preview.extractionStatus === "empty" || preview.characterCount === 0) {
    return {
      title: "No text found in PDF",
      detail:
        preview.warnings[0] ??
        "This appears to be a scanned or image-only PDF. Baxter couldn't find a readable text layer.",
      tone: "warn",
    };
  }
  if (preview.duplicateEntryId) {
    return {
      title: "Duplicate file",
      detail: "This file already exists in Baxter.",
      tone: "warn",
    };
  }
  return {
    title: "Ready for review",
    detail: "Text extracted successfully. Review the preview, then import.",
    tone: "ok",
  };
}

export function KnowledgeUploadClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialJurisdiction = searchParams.get("jurisdiction") ?? "";
  const initialDocKind = (searchParams.get("doc_kind") as KnowledgeDocKind | null) ?? "";
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"draft" | "approved">("draft");
  const [category, setCategory] = useState("General");
  const [tags, setTags] = useState("uploaded");
  const [jurisdictionKey, setJurisdictionKey] = useState(initialJurisdiction);
  const [docKind, setDocKind] = useState<KnowledgeDocKind | "">(initialDocKind);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imported, setImported] = useState<
    Array<{ filename: string; entryId: string; readyLabel: string }>
  >([]);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const hasBlockingPreview = previews.some((row) => row.extractionStatus === "failed");

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
    setPhase("Uploading…");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("action", "preview");
      for (const file of files) form.append("files", file);
      setPhase(
        files.some((f) => f.name.toLowerCase().endsWith(".pdf"))
          ? "Processing PDF…"
          : "Reading files…",
      );
      const response = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        body: form,
      });
      setPhase(
        files.some((f) => f.name.toLowerCase().endsWith(".pdf")) ? "Extracting text…" : "Parsing…",
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Preview failed");
      const rows = (payload.previews ?? []) as PreviewRow[];
      setPreviews(rows);
      const nextTitles: Record<string, string> = {};
      for (const row of rows) nextTitles[row.filename] = row.title;
      setTitles(nextTitles);
      setPhase(null);
      const failed = rows.filter((r) => r.extractionStatus === "failed").length;
      const empty = rows.filter((r) => r.extractionStatus === "empty").length;
      if (failed > 0) {
        setMessage(
          `Preview finished with ${failed} file(s) that could not be processed. Fix or remove them, then try again.`,
        );
      } else if (empty > 0) {
        setMessage(
          `Preview ready. ${empty} file(s) had no extractable text — review warnings before importing.`,
        );
      } else {
        setMessage(`Preview ready for ${rows.length} file(s). Review, then import.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (files.length === 0) return;
    if (hasBlockingPreview) {
      setError("Remove or replace files that failed processing before importing.");
      return;
    }
    setBusy(true);
    setPhase("Indexing…");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("action", "import");
      form.set("status", status);
      form.set("category", category);
      form.set("tags", tags);
      if (jurisdictionKey) form.set("jurisdiction_key", jurisdictionKey);
      if (docKind) form.set("doc_kind", docKind);
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
      const readyLabel = status === "approved" ? "Ready" : "Ready for review";
      setImported(results.map((row) => ({ ...row, readyLabel })));
      setPhase("Complete");
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
            Drag and drop or use the file picker. Preview extracted text before importing. Max size
            follows <code className="text-xs">KNOWLEDGE_UPLOAD_MAX_MB</code> (default 20 MB).
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
                accept=".md,.markdown,.txt,.pdf,.docx,.csv,.xlsx,.png,.jpg,.jpeg,.webp,.pptx"
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
                setError(null);
                setMessage(null);
                setPhase(null);
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
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="importJurisdiction">
                  Jurisdiction (optional)
                </label>
                <select
                  id="importJurisdiction"
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
                  value={jurisdictionKey}
                  onChange={(event) => setJurisdictionKey(event.target.value)}
                >
                  <option value="">None (Acton process knowledge)</option>
                  {SUPPORTED_JURISDICTIONS.map((jurisdiction) => (
                    <option key={jurisdiction.key} value={jurisdiction.key}>
                      {jurisdiction.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="importDocKind">
                  Document kind (optional)
                </label>
                <select
                  id="importDocKind"
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
                  value={docKind}
                  onChange={(event) => setDocKind(event.target.value as KnowledgeDocKind | "")}
                >
                  <option value="">None</option>
                  <option value="building_code">Building code</option>
                  <option value="ordinance">Ordinance</option>
                  <option value="design_guideline">Design guideline</option>
                  <option value="other_code">Other code document</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || hasBlockingPreview}
                onClick={() => void runImport()}
              >
                Import {previews.length} file(s)
              </Button>
              {hasBlockingPreview ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void runPreview()}
                >
                  Try again
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {previews.map((preview) => {
          const headline = previewHeadline(preview);
          const toneClass =
            headline.tone === "error"
              ? "text-red-800"
              : headline.tone === "warn"
                ? "text-amber-900"
                : "text-[var(--acton-navy)]";
          return (
            <Card key={preview.contentHash + preview.filename}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{preview.filename}</CardTitle>
                  <CardDescription className={`mt-1 font-medium ${toneClass}`}>
                    {headline.title}
                  </CardDescription>
                  <CardDescription className="mt-1">
                    {preview.extension.toUpperCase()} · {preview.extractionStatus} ·{" "}
                    {preview.wordCount} words · {preview.characterCount} chars
                  </CardDescription>
                  <p className="mt-1 text-sm text-[var(--acton-muted)]">{headline.detail}</p>
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
                    setTitles((current) => ({
                      ...current,
                      [preview.filename]: event.target.value,
                    }))
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
              {preview.extractionStatus === "failed" ? (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void runPreview()}
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap">
                  {preview.previewText ||
                    (preview.extractionStatus === "empty"
                      ? "No selectable text layer found."
                      : "No preview available.")}
                  {preview.truncatedPreview ? "\n\n[Preview truncated]" : ""}
                </pre>
              )}
            </Card>
          );
        })}

        {imported.length > 0 ? (
          <Card>
            <CardTitle>Imported</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {imported.map((row) => (
                <li key={row.entryId}>
                  <span className="font-medium">{row.filename}</span> — {row.readyLabel}{" "}
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
