"use client";

import { useState } from "react";

type ImageUnit = {
  unit_type?: string;
  content?: string;
  structured_data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export function ImageKnowledgeViewer({
  title,
  filename,
  sourceUrl,
  imageUrl,
  extractedText,
  description,
  importantFacts,
  warnings,
  indexStatus,
  documentType,
}: {
  title: string;
  filename?: string | null;
  sourceUrl?: string | null;
  /** Direct image URL when available (storage signed URL, Drive view link, etc.). */
  imageUrl?: string | null;
  extractedText?: string | null;
  description?: string | null;
  importantFacts?: string[];
  warnings?: string[];
  indexStatus?: string | null;
  documentType?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const previewSrc = imageUrl || sourceUrl || null;
  const facts = importantFacts?.filter(Boolean) ?? [];
  const warns = warnings?.filter(Boolean) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">{title}</p>
          {filename ? <p className="mt-1 text-xs text-[var(--acton-muted)]">{filename}</p> : null}
          {documentType ? (
            <p className="mt-1 text-xs text-[var(--acton-muted)]">Type: {documentType}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {indexStatus ? (
            <span className="rounded-md bg-[var(--acton-gray-50)] px-2 py-1 text-xs font-semibold text-[var(--acton-navy)]">
              Index: {indexStatus}
            </span>
          ) : null}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold underline"
            >
              Open original
            </a>
          ) : null}
        </div>
      </div>

      {previewSrc && !imgFailed ? (
        <div className="overflow-hidden rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt={filename || title}
            className="mx-auto max-h-[480px] w-auto max-w-full object-contain"
            onError={() => setImgFailed(true)}
          />
        </div>
      ) : previewSrc ? (
        <p className="text-sm text-[var(--acton-muted)]">
          Image preview unavailable. Use Open original to view the file.
        </p>
      ) : null}

      {description ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--acton-navy)]">AI description</h3>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-muted)]">
            {description}
          </p>
        </section>
      ) : null}

      {extractedText ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Extracted text</h3>
          <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
            {extractedText}
          </pre>
        </section>
      ) : null}

      {facts.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Important facts</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--acton-navy)]">
            {facts.map((fact, idx) => (
              <li key={`${idx}-${fact.slice(0, 24)}`}>{fact}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {warns.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-amber-900">Warnings</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {warns.map((w, idx) => (
              <li key={`${idx}-${w.slice(0, 24)}`}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!description && !extractedText && facts.length === 0 ? (
        <p className="text-sm text-[var(--acton-muted)]">
          No image analysis is stored yet. Re-sync or reindex this source to generate a description
          and OCR text.
        </p>
      ) : null}
    </div>
  );
}

/** Pull display fields from knowledge entry metadata + image units. */
export function imageViewerPropsFromMeta(input: {
  title: string;
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  summary?: string | null;
  metadata: Record<string, unknown>;
  indexStatus?: string | null;
}): {
  title: string;
  filename: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  extractedText: string | null;
  description: string | null;
  importantFacts: string[];
  warnings: string[];
  indexStatus: string | null;
  documentType: string | null;
} {
  const meta = input.metadata;
  const imageMeta = (meta.imageMeta ?? {}) as Record<string, unknown>;
  const units = (Array.isArray(meta.imageUnits) ? meta.imageUnits : []) as ImageUnit[];

  const descUnit = units.find((u) => u.unit_type === "image_description");
  const ocrUnit = units.find((u) => u.unit_type === "image_ocr");
  const factsUnit = units.find(
    (u) => u.unit_type === "key_value" || Array.isArray(u.structured_data?.importantFacts),
  );

  const structuredFacts = [
    ...(Array.isArray(descUnit?.structured_data?.importantFacts)
      ? (descUnit!.structured_data!.importantFacts as unknown[]).map(String)
      : []),
    ...(Array.isArray(factsUnit?.structured_data?.facts)
      ? (factsUnit!.structured_data!.facts as unknown[]).map(String)
      : []),
    ...(Array.isArray(meta.importantFacts) ? (meta.importantFacts as unknown[]).map(String) : []),
  ];

  const filename =
    (typeof meta.originalFilename === "string" && meta.originalFilename) ||
    (typeof imageMeta.filename === "string" && imageMeta.filename) ||
    null;

  const extractedText =
    (typeof meta.extractedText === "string" && meta.extractedText) ||
    (typeof ocrUnit?.structured_data?.extractedText === "string"
      ? ocrUnit.structured_data.extractedText
      : null) ||
    (ocrUnit?.content ? stripImagePrefix(ocrUnit.content) : null);

  const description =
    (typeof input.summary === "string" && input.summary) ||
    (descUnit?.content ? stripImagePrefix(descUnit.content) : null) ||
    null;

  const warnings = [
    ...(Array.isArray(meta.extractionWarnings)
      ? (meta.extractionWarnings as unknown[]).map(String)
      : []),
    ...(Array.isArray(meta.index_warnings) ? (meta.index_warnings as unknown[]).map(String) : []),
    ...(Array.isArray(imageMeta.warnings) ? (imageMeta.warnings as unknown[]).map(String) : []),
    ...(Array.isArray(descUnit?.structured_data?.warnings)
      ? (descUnit!.structured_data!.warnings as unknown[]).map(String)
      : []),
  ];

  const storageUrl =
    (typeof meta.storageUrl === "string" && meta.storageUrl) ||
    (typeof meta.previewUrl === "string" && meta.previewUrl) ||
    (typeof meta.imageUrl === "string" && meta.imageUrl) ||
    null;

  // Google Drive direct-view fallback when we have a file id
  const drivePreview =
    input.sourceExternalId && !storageUrl
      ? `https://drive.google.com/uc?export=view&id=${input.sourceExternalId}`
      : null;

  return {
    title: input.title,
    filename,
    sourceUrl: input.sourceUrl ?? null,
    imageUrl: storageUrl || drivePreview || input.sourceUrl || null,
    extractedText,
    description,
    importantFacts: Array.from(new Set(structuredFacts)),
    warnings: Array.from(new Set(warnings)),
    indexStatus:
      input.indexStatus ||
      (typeof meta.index_status === "string" ? meta.index_status : null) ||
      null,
    documentType:
      (typeof meta.documentType === "string" && meta.documentType) ||
      (typeof imageMeta.documentType === "string" && imageMeta.documentType) ||
      null,
  };
}

function stripImagePrefix(content: string): string {
  return content
    .replace(/^Image(\s+OCR)?:[^\n]*\n?/i, "")
    .replace(/^Image facts:[^\n]*\n?/i, "")
    .trim();
}
