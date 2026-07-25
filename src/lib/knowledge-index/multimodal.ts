import "server-only";

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { DraftUnit } from "./chunking";
import { KNOWLEDGE_INDEX_VERSION, type KnowledgeUnitType } from "./types";
import type { ImageAnalysisResult } from "@/lib/baxter-ai/vision";

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function draft(
  unit_type: KnowledgeUnitType,
  ordinal: number,
  title: string,
  content: string,
  structured_data: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): DraftUnit {
  return {
    unit_type,
    ordinal,
    title,
    content,
    search_text: content,
    structured_data,
    metadata,
    content_hash: hash(content),
    index_version: KNOWLEDGE_INDEX_VERSION,
  };
}

export function unitsFromImageAnalysis(input: {
  title: string;
  analysis: ImageAnalysisResult;
  sourceUrl?: string | null;
  mimeType?: string;
  filename?: string;
}): DraftUnit[] {
  const units: DraftUnit[] = [];
  let ordinal = 0;
  const desc = input.analysis.description.trim();
  if (desc) {
    units.push(
      draft(
        "image_description",
        ordinal++,
        input.title,
        `Image: ${input.title}\n${desc}`,
        {
          documentType: input.analysis.documentType,
          importantFacts: input.analysis.importantFacts,
          entities: input.analysis.entities,
          warnings: input.analysis.warnings,
        },
        {
          mimeType: input.mimeType,
          filename: input.filename,
          sourceUrl: input.sourceUrl ?? null,
        },
      ),
    );
  }
  const ocr = input.analysis.extractedText.trim();
  if (ocr) {
    units.push(
      draft(
        "image_ocr",
        ordinal++,
        `${input.title} (OCR)`,
        `Image OCR: ${input.title}\n${ocr}`,
        { extractedText: ocr },
        { mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null },
      ),
    );
  }
  if (input.analysis.importantFacts.length) {
    units.push(
      draft(
        "key_value",
        ordinal++,
        `${input.title} facts`,
        `Image facts: ${input.title}\n${input.analysis.importantFacts.join("\n")}`,
        { facts: input.analysis.importantFacts },
        {},
      ),
    );
  }
  if (units.length === 0) {
    units.push(
      draft(
        "image_description",
        0,
        input.title,
        `Image: ${input.title}\nNo extractable content.`,
        { warnings: input.analysis.warnings },
        { mimeType: input.mimeType },
      ),
    );
  }
  return units;
}

export function unitsFromPdfPages(input: {
  title: string;
  pages: Array<{ pageNumber: number; text: string }>;
  sourceUrl?: string | null;
}): DraftUnit[] {
  return input.pages
    .filter((p) => p.text.trim().length > 0)
    .map((p, index) =>
      draft(
        "pdf_page",
        index,
        `${input.title} — Page ${p.pageNumber}`,
        `Document: ${input.title}\nPage: ${p.pageNumber}\n${p.text.trim()}`,
        { pageNumber: p.pageNumber },
        { sourceUrl: input.sourceUrl ?? null, pageNumber: p.pageNumber },
      ),
    );
}

export function unitsFromSlides(input: {
  title: string;
  slides: Array<{
    slideNumber: number;
    title?: string;
    text: string;
    notes?: string;
  }>;
  sourceUrl?: string | null;
}): DraftUnit[] {
  return input.slides.map((s, index) => {
    const slideTitle = s.title?.trim() || `Slide ${s.slideNumber}`;
    const parts = [
      `Presentation: ${input.title}`,
      `Slide: ${s.slideNumber}`,
      slideTitle !== `Slide ${s.slideNumber}` ? `Title: ${slideTitle}` : null,
      s.text.trim(),
      s.notes?.trim() ? `Notes: ${s.notes.trim()}` : null,
    ].filter(Boolean);
    return draft(
      "slide",
      index,
      `${input.title} — Slide ${s.slideNumber}`,
      parts.join("\n"),
      {
        slideNumber: s.slideNumber,
        slideTitle,
        notes: s.notes ?? null,
      },
      { sourceUrl: input.sourceUrl ?? null, slideNumber: s.slideNumber },
    );
  });
}

/**
 * Minimal PPTX slide text extraction via ZIP local-file inflate (no extra dependency).
 */
export function extractPptxSlides(buffer: Buffer): Array<{
  slideNumber: number;
  title?: string;
  text: string;
}> {
  const entries = listZipEntries(buffer);
  const slideFiles = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.name.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });

  return slideFiles.map((entry, index) => {
    const xml = entry.data.toString("utf8");
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m) =>
      decodeXml(m[1] ?? ""),
    );
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    return {
      slideNumber: index + 1,
      title: texts[0]?.slice(0, 120),
      text: joined,
    };
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

type ZipEntry = { name: string; data: Buffer };

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compression === 0) data = compressed;
    else if (compression === 8) {
      try {
        data = inflateRawSync(compressed);
      } catch {
        data = Buffer.alloc(0);
      }
    } else {
      data = Buffer.alloc(0);
    }
    if (name && !name.endsWith("/")) entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}
