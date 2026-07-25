import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

/**
 * Split PDF text into page-ish chunks using form-feed when present,
 * otherwise approximate by equal slices using reported page count.
 */
export function splitPdfTextIntoPages(
  text: string,
  numPages: number | null | undefined,
): Array<{ pageNumber: number; text: string }> {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) return [];

  if (normalized.includes("\f")) {
    return normalized
      .split("\f")
      .map((chunk, index) => ({ pageNumber: index + 1, text: chunk.trim() }))
      .filter((p) => p.text.length > 0);
  }

  const pages = Math.max(1, numPages ?? 1);
  if (pages === 1) {
    return [{ pageNumber: 1, text: normalized }];
  }

  const approx = Math.ceil(normalized.length / pages);
  const out: Array<{ pageNumber: number; text: string }> = [];
  for (let i = 0; i < pages; i++) {
    const slice = normalized.slice(i * approx, (i + 1) * approx).trim();
    if (slice) out.push({ pageNumber: i + 1, text: slice });
  }
  return out.length ? out : [{ pageNumber: 1, text: normalized }];
}

export async function parsePdf(filename: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const limits = getUploadLimits();
  const warnings: string[] = [];
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse =
      (
        pdfParseModule as {
          default?: (buf: Buffer) => Promise<{ text?: string; numpages?: number }>;
        }
      ).default ??
      (pdfParseModule as unknown as (buf: Buffer) => Promise<{ text?: string; numpages?: number }>);
    const result = await pdfParse(buffer);
    const raw = (result.text ?? "").replace(/\u0000/g, "").trim();
    const pdfPages = splitPdfTextIntoPages(raw, result.numpages ?? null);

    if (!raw) {
      warnings.push(
        "No selectable text was found. This may be a scanned PDF. Vision/OCR analysis can run during Baxter indexing when configured.",
      );
      return {
        filename,
        title: titleFromFilename(filename),
        mimeType: "application/pdf",
        extension: "pdf",
        content: "",
        summary: null,
        warnings,
        metadata: {
          pages: result.numpages ?? null,
          pdfPages: [],
          ocrSupported: true,
          needsVisionOcr: true,
        },
        extractionStatus: "empty",
      };
    }

    const pageBlocks = pdfPages.map((p) => `## Page ${p.pageNumber}\n${p.text}`).join("\n\n");
    const { content, truncated } = truncateContent(pageBlocks || raw, limits.maxCharacters);
    if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);

    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/pdf",
      extension: "pdf",
      content,
      summary: null,
      warnings,
      metadata: {
        pages: result.numpages ?? pdfPages.length,
        pdfPages,
        truncated,
        ocrSupported: true,
      },
      extractionStatus: truncated ? "partial" : "success",
    };
  } catch (error) {
    warnings.push(
      error instanceof Error ? `PDF parse failed: ${error.message}` : "PDF parse failed.",
    );
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/pdf",
      extension: "pdf",
      content: "",
      summary: null,
      warnings,
      metadata: { ocrSupported: true },
      extractionStatus: "failed",
    };
  }
}
