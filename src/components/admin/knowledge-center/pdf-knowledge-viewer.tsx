"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export type PdfPageView = {
  pageNumber: number;
  text: string;
};

type SourceMeta = {
  kind: "upload_pdf" | "google_pdf" | "none";
  viewUrl: string | null;
  openUrl: string | null;
  available: boolean;
  unavailableReason: string | null;
  originalFilename: string | null;
};

function isSameOriginViewerUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/") || url.includes("/api/admin/knowledge/");
}

export function PdfKnowledgeViewer({
  entryId,
  title,
  pages,
  sourceUrl,
  isGoogle,
  ocrStatus,
  defaultPane = "pdf",
}: {
  entryId: string;
  title: string;
  pages: PdfPageView[];
  sourceUrl?: string | null;
  isGoogle?: boolean;
  ocrStatus?: string | null;
  defaultPane?: "pdf" | "text";
}) {
  const sorted = useMemo(() => [...pages].sort((a, b) => a.pageNumber - b.pageNumber), [pages]);
  const [pane, setPane] = useState<"pdf" | "text">(defaultPane);
  const [source, setSource] = useState<SourceMeta | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingSource(true);
      setSourceError(null);
      try {
        const response = await fetch(`/api/admin/knowledge/${entryId}/source-file`);
        const payload = (await response.json()) as {
          source?: SourceMeta;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Could not load PDF source");
        }
        if (cancelled) return;
        setSource(payload.source ?? null);
        setIframeKey((k) => k + 1);
      } catch (err) {
        if (cancelled) return;
        setSourceError(err instanceof Error ? err.message : "Could not load PDF source");
        if (isGoogle && sourceUrl) {
          setSource({
            kind: "google_pdf",
            viewUrl: null,
            openUrl: sourceUrl,
            available: false,
            unavailableReason:
              "Baxter couldn't embed this Google Drive PDF. Use Open in Google, or view extracted text.",
            originalFilename: title,
          });
        } else {
          setSource(null);
        }
      } finally {
        if (!cancelled) setLoadingSource(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [entryId, isGoogle, sourceUrl, title, reloadToken]);

  function tryAgain() {
    setReloadToken((n) => n + 1);
  }

  const openHref = source?.openUrl ?? (isGoogle ? sourceUrl : null) ?? null;
  const viewHref = source?.viewUrl ?? null;
  const available = Boolean(source?.available && viewHref);
  const openLabel = isGoogle || source?.kind === "google_pdf" ? "Open in Google" : "Open Original";
  const sameOrigin = isSameOriginViewerUrl(viewHref);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">{title}</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {isGoogle || source?.kind === "google_pdf" ? "Google Drive PDF" : "PDF"}
            {sorted.length
              ? ` · ${sorted.length} page${sorted.length === 1 ? "" : "s"} indexed`
              : ""}
            {ocrStatus ? ` · ${ocrStatus}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-md border border-[var(--acton-border)] px-3 text-sm font-semibold text-[var(--acton-navy)]"
            >
              {openLabel}
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--acton-border)]">
        <button
          type="button"
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${
            pane === "pdf"
              ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
              : "border-transparent text-[var(--acton-muted)]"
          }`}
          onClick={() => setPane("pdf")}
        >
          PDF
        </button>
        <button
          type="button"
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${
            pane === "text"
              ? "border-[var(--acton-navy)] text-[var(--acton-navy)]"
              : "border-transparent text-[var(--acton-muted)]"
          }`}
          onClick={() => setPane("text")}
        >
          Extracted Text
        </button>
      </div>

      {pane === "pdf" ? (
        <div className="space-y-3">
          {loadingSource ? <p className="text-sm text-[var(--acton-muted)]">Loading PDF…</p> : null}
          {!loadingSource && !available ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
              <p className="font-semibold">PDF unavailable</p>
              <p className="mt-1">
                {source?.unavailableReason ??
                  sourceError ??
                  "Baxter couldn't load the original PDF."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => tryAgain()}>
                  Try Again
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPane("text")}>
                  View Extracted Text
                </Button>
                {openHref && (isGoogle || source?.kind === "google_pdf") ? (
                  <a
                    href={openHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-md border border-[var(--acton-border)] px-3 text-sm font-semibold text-[var(--acton-navy)]"
                  >
                    Open in Google
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
          {available && viewHref ? (
            <iframe
              key={iframeKey}
              title={`PDF viewer — ${title}`}
              src={viewHref}
              className="h-[75vh] w-full rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)]"
              // Same-origin PDF streams must not use sandbox — it breaks the native PDF viewer.
              // Drive previews may need scripts; keep a light sandbox only for cross-origin.
              {...(sameOrigin
                ? {}
                : { sandbox: "allow-scripts allow-same-origin allow-popups allow-downloads" })}
            />
          ) : null}
        </div>
      ) : (
        <ExtractedPdfText pages={sorted} />
      )}
    </div>
  );
}

function ExtractedPdfText({ pages }: { pages: PdfPageView[] }) {
  if (!pages.length) {
    return (
      <p className="text-sm text-[var(--acton-muted)]">
        No extracted text is available for this PDF yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {pages.map((page) => (
        <section
          key={page.pageNumber}
          className="rounded-lg border border-[var(--acton-border)] bg-white p-4"
        >
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Page {page.pageNumber}
          </h3>
          <pre className="max-h-[28rem] overflow-auto text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
            {page.text.trim() || "No text extracted for this page."}
          </pre>
        </section>
      ))}
    </div>
  );
}

export function pdfPagesFromMeta(
  metadata: Record<string, unknown>,
  content?: string | null,
): PdfPageView[] {
  const fromMeta = Array.isArray(metadata.pdfPages)
    ? (metadata.pdfPages as Array<{ pageNumber?: number; text?: string }>)
        .map((p, idx) => ({
          pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : idx + 1,
          text: String(p.text ?? "").trim(),
        }))
        .filter((p) => p.text.length > 0)
    : [];

  if (fromMeta.length) return fromMeta;

  const units = Array.isArray(metadata.units) ? metadata.units : [];
  const fromUnits = (units as Array<Record<string, unknown>>)
    .filter((u) => u.unit_type === "pdf_page")
    .map((u, idx) => {
      const structured = (u.structured_data ?? {}) as Record<string, unknown>;
      const meta = (u.metadata ?? {}) as Record<string, unknown>;
      const pageNumber =
        (typeof structured.pageNumber === "number" && structured.pageNumber) ||
        (typeof meta.pageNumber === "number" && meta.pageNumber) ||
        idx + 1;
      const raw = String(u.content ?? "");
      const text = raw.replace(/^Document:[^\n]*\nPage:\s*\d+\n?/i, "").trim();
      return { pageNumber, text };
    })
    .filter((p) => p.text.length > 0);

  if (fromUnits.length) return fromUnits;

  if (!content) return [];
  const sections = content.split(/\n(?=## Page\s+\d+)/i);
  const fromContent: PdfPageView[] = [];
  for (const section of sections) {
    const match = section.match(/^## Page\s+(\d+)\s*\n([\s\S]*)/i);
    if (!match) continue;
    const text = match[2]!.trim();
    if (!text) continue;
    fromContent.push({ pageNumber: Number(match[1]), text });
  }
  return fromContent;
}
