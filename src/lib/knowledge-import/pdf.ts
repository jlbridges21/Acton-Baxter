import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

export async function parsePdf(filename: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const limits = getUploadLimits();
  const warnings: string[] = [];
  try {
    // pdf-parse is CommonJS; dynamic import keeps Next bundling happier.
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
    if (!raw) {
      warnings.push(
        "No selectable text was found. This may be a scanned PDF. OCR is not currently supported.",
      );
      return {
        filename,
        title: titleFromFilename(filename),
        mimeType: "application/pdf",
        extension: "pdf",
        content: "",
        summary: null,
        warnings,
        metadata: { pages: result.numpages ?? null, ocrSupported: false },
        extractionStatus: "empty",
      };
    }
    const { content, truncated } = truncateContent(raw, limits.maxCharacters);
    if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/pdf",
      extension: "pdf",
      content,
      summary: null,
      warnings,
      metadata: { pages: result.numpages ?? null, truncated, ocrSupported: false },
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
      metadata: { ocrSupported: false },
      extractionStatus: "failed",
    };
  }
}
