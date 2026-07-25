"use client";

import { useMemo } from "react";

export type SlideView = {
  slideNumber: number;
  title: string;
  text: string;
  description?: string | null;
};

export function PresentationKnowledgeViewer({
  title,
  slides,
  sourceUrl,
}: {
  title: string;
  slides: SlideView[];
  sourceUrl?: string | null;
}) {
  const sorted = useMemo(() => [...slides].sort((a, b) => a.slideNumber - b.slideNumber), [slides]);

  if (!sorted.length) {
    return (
      <p className="text-sm text-[var(--acton-muted)]">
        Slide text is not indexed yet. Use Reindex or re-sync from Google.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">{title}</p>
          <p className="text-xs text-[var(--acton-muted)]">
            {sorted.length} slide{sorted.length === 1 ? "" : "s"}
          </p>
        </div>
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

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((slide) => (
          <article
            key={slide.slideNumber}
            className="rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)]/40 p-4"
          >
            <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Slide {slide.slideNumber}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
              {slide.title || `Slide ${slide.slideNumber}`}
            </h3>
            {slide.description ? (
              <p className="mt-2 text-sm text-[var(--acton-muted)]">{slide.description}</p>
            ) : null}
            <p className="mt-2 max-h-40 overflow-auto text-sm leading-relaxed whitespace-pre-wrap text-[var(--acton-navy)]">
              {slide.text.trim() || "No text extracted for this slide."}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function slidesFromMeta(
  metadata: Record<string, unknown>,
  content?: string | null,
): SlideView[] {
  const units = Array.isArray(metadata.slideUnits)
    ? (metadata.slideUnits as Array<Record<string, unknown>>)
    : [];

  if (units.length) {
    return units.map((u, idx) => {
      const structured = (u.structured_data ?? {}) as Record<string, unknown>;
      const meta = (u.metadata ?? {}) as Record<string, unknown>;
      const slideNumber =
        (typeof structured.slideNumber === "number" && structured.slideNumber) ||
        (typeof meta.slideNumber === "number" && meta.slideNumber) ||
        idx + 1;
      const slideTitle =
        (typeof structured.slideTitle === "string" && structured.slideTitle) ||
        `Slide ${slideNumber}`;
      const raw = String(u.content ?? "");
      const text = raw
        .replace(/^Presentation:[^\n]*\n?/i, "")
        .replace(/^Slide:\s*\d+\n?/i, "")
        .replace(/^Title:\s*[^\n]*\n?/i, "")
        .trim();
      return {
        slideNumber,
        title: slideTitle,
        text,
        description: typeof structured.notes === "string" ? structured.notes : null,
      };
    });
  }

  if (!content) return [];

  // Fallback: parse "## Slide N" or "Slide: N" sections from content
  const blocks = content.split(/\n(?=(?:##\s+)?Slide\s+\d+)/i);
  const slides: SlideView[] = [];
  for (const block of blocks) {
    const match = block.match(/^(?:##\s+)?Slide\s+(\d+)\s*[:\-]?\s*([^\n]*)\n?([\s\S]*)/i);
    if (!match) continue;
    const slideNumber = Number(match[1]);
    const titlePart = match[2]!.trim();
    const body = match[3]!.trim();
    slides.push({
      slideNumber,
      title: titlePart || `Slide ${slideNumber}`,
      text: body,
    });
  }
  return slides;
}
