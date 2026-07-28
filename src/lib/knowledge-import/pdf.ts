import "server-only";

import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

export type PdfExtractionMethod = "pdf_text" | "ocr" | "multimodal" | "none";

export type PdfExtractionErrorCode =
  | "PDF_PARSE_FAILED"
  | "PDF_NO_TEXT"
  | "PDF_PASSWORD_PROTECTED"
  | "PDF_INVALID"
  | "PDF_TOO_LARGE"
  | "PDF_UNSUPPORTED"
  | "PDF_EXTRACTION_TIMEOUT";

export type PdfPageText = {
  pageNumber: number;
  text: string;
};

export type PdfExtractionResult = {
  success: boolean;
  text: string;
  pages: PdfPageText[];
  pageCount: number;
  extractionMethod: PdfExtractionMethod;
  warnings: string[];
  errorCode: PdfExtractionErrorCode | null;
  /** Admin-facing message suitable for UI (never raw library stack traces). */
  userMessage: string | null;
};

const PDF_MAGIC = Buffer.from("%PDF-");
const DEFAULT_PDF_MAX_PAGES = 200;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 45_000;

const USER_MESSAGES: Record<PdfExtractionErrorCode, string> = {
  PDF_PARSE_FAILED: "Baxter couldn't read this PDF. Please try again or upload another copy.",
  PDF_NO_TEXT:
    "This appears to be a scanned or image-only PDF. Baxter couldn't find a readable text layer.",
  PDF_PASSWORD_PROTECTED:
    "This PDF is password protected and Baxter can't read it. Upload an unlocked copy and try again.",
  PDF_INVALID: "This file doesn't look like a valid PDF. Upload a different copy and try again.",
  PDF_TOO_LARGE: "This PDF exceeds Baxter's size or page limits.",
  PDF_UNSUPPORTED: "This PDF format isn't supported.",
  PDF_EXTRACTION_TIMEOUT: "PDF processing took too long. Try a smaller file or fewer pages.",
};

function getPdfLimits() {
  const upload = getUploadLimits();
  const maxPagesRaw = Number(process.env.KNOWLEDGE_PDF_MAX_PAGES ?? String(DEFAULT_PDF_MAX_PAGES));
  const timeoutRaw = Number(
    process.env.KNOWLEDGE_PDF_EXTRACTION_TIMEOUT_MS ?? String(DEFAULT_EXTRACTION_TIMEOUT_MS),
  );
  return {
    maxBytes: upload.maxBytes,
    maxCharacters: upload.maxCharacters,
    maxPages:
      Number.isFinite(maxPagesRaw) && maxPagesRaw > 0
        ? Math.floor(maxPagesRaw)
        : DEFAULT_PDF_MAX_PAGES,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? Math.floor(timeoutRaw)
        : DEFAULT_EXTRACTION_TIMEOUT_MS,
  };
}

export function isPdfSignature(buffer: Buffer): boolean {
  if (buffer.byteLength < 5) return false;
  return buffer.subarray(0, 5).equals(PDF_MAGIC);
}

/** Light normalization: control chars, nulls, runaway whitespace — preserve structure. */
export function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Split PDF text into page chunks using form-feed when present,
 * otherwise approximate by equal slices using reported page count.
 */
export function splitPdfTextIntoPages(
  text: string,
  numPages: number | null | undefined,
): PdfPageText[] {
  const normalized = normalizePdfText(text);
  if (!normalized) return [];

  if (normalized.includes("\f")) {
    return normalized
      .split("\f")
      .map((chunk, index) => ({ pageNumber: index + 1, text: normalizePdfText(chunk) }))
      .filter((p) => p.text.length > 0);
  }

  const pages = Math.max(1, numPages ?? 1);
  if (pages === 1) {
    return [{ pageNumber: 1, text: normalized }];
  }

  const approx = Math.ceil(normalized.length / pages);
  const out: PdfPageText[] = [];
  for (let i = 0; i < pages; i++) {
    const slice = normalizePdfText(normalized.slice(i * approx, (i + 1) * approx));
    if (slice) out.push({ pageNumber: i + 1, text: slice });
  }
  return out.length ? out : [{ pageNumber: 1, text: normalized }];
}

function classifyPdfError(error: unknown): PdfExtractionErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (name === "PasswordException" || lower.includes("password") || lower.includes("encrypted")) {
    return "PDF_PASSWORD_PROTECTED";
  }
  if (
    name === "InvalidPDFException" ||
    lower.includes("invalid pdf") ||
    lower.includes("invalid pdf structure")
  ) {
    return "PDF_INVALID";
  }
  if (lower.includes("timeout") || name === "TimeoutError") {
    return "PDF_EXTRACTION_TIMEOUT";
  }
  if (lower.includes("dommatrix") || lower.includes("canvas") || lower.includes("worker")) {
    // Treat browser-API failures as parse failures (should not happen with unpdf).
    return "PDF_PARSE_FAILED";
  }
  return "PDF_PARSE_FAILED";
}

function logPdfDiagnostics(payload: Record<string, unknown>) {
  // Structured, content-free diagnostics for Vercel/server logs.
  console.info(JSON.stringify({ scope: "knowledge.pdf", ...payload }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error("PDF extraction timed out");
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Server-side PDF text extraction via unpdf (serverless PDF.js build).
 * Does not require browser globals such as DOMMatrix / Canvas.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  const started = Date.now();
  const limits = getPdfLimits();

  if (!buffer.byteLength) {
    return {
      success: false,
      text: "",
      pages: [],
      pageCount: 0,
      extractionMethod: "none",
      warnings: [USER_MESSAGES.PDF_INVALID],
      errorCode: "PDF_INVALID",
      userMessage: USER_MESSAGES.PDF_INVALID,
    };
  }

  if (buffer.byteLength > limits.maxBytes) {
    return {
      success: false,
      text: "",
      pages: [],
      pageCount: 0,
      extractionMethod: "none",
      warnings: [USER_MESSAGES.PDF_TOO_LARGE],
      errorCode: "PDF_TOO_LARGE",
      userMessage: USER_MESSAGES.PDF_TOO_LARGE,
    };
  }

  if (!isPdfSignature(buffer)) {
    return {
      success: false,
      text: "",
      pages: [],
      pageCount: 0,
      extractionMethod: "none",
      warnings: [USER_MESSAGES.PDF_INVALID],
      errorCode: "PDF_INVALID",
      userMessage: USER_MESSAGES.PDF_INVALID,
    };
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const data = new Uint8Array(buffer);

    const result = await withTimeout(
      (async () => {
        const pdf = await getDocumentProxy(data, {
          // Keep text extraction lean; avoid browser font-face paths.
          useSystemFonts: true,
          disableFontFace: true,
        });
        const pageCount = pdf.numPages ?? 0;
        if (pageCount > limits.maxPages) {
          const err = new Error(`PDF exceeds max page count (${limits.maxPages})`);
          (err as Error & { code?: string }).code = "PDF_TOO_LARGE";
          throw err;
        }
        const extracted = await extractText(pdf, { mergePages: false });
        return extracted;
      })(),
      limits.timeoutMs,
    );

    const pageTexts = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
    const pages: PdfPageText[] = pageTexts
      .map((pageText, index) => ({
        pageNumber: index + 1,
        text: normalizePdfText(pageText),
      }))
      .filter((p) => p.text.length > 0);

    const pageCount = Math.max(result.totalPages ?? 0, pages.length);
    const combined = normalizePdfText(pages.map((p) => p.text).join("\n\n"));

    if (!combined) {
      logPdfDiagnostics({
        result: "no_text",
        errorCode: "PDF_NO_TEXT",
        fileSize: buffer.byteLength,
        pageCount,
        extractionMethod: "none",
        durationMs: Date.now() - started,
      });
      return {
        success: true,
        text: "",
        pages: [],
        pageCount,
        extractionMethod: "none",
        warnings: [USER_MESSAGES.PDF_NO_TEXT],
        errorCode: "PDF_NO_TEXT",
        userMessage: USER_MESSAGES.PDF_NO_TEXT,
      };
    }

    logPdfDiagnostics({
      result: "success",
      errorCode: null,
      fileSize: buffer.byteLength,
      pageCount,
      extractionMethod: "pdf_text",
      durationMs: Date.now() - started,
      characterCount: combined.length,
    });

    return {
      success: true,
      text: combined,
      pages:
        pages.length > 0
          ? pages
          : splitPdfTextIntoPages(combined, pageCount || result.totalPages || 1),
      pageCount: pageCount || pages.length || 1,
      extractionMethod: "pdf_text",
      warnings: [],
      errorCode: null,
      userMessage: null,
    };
  } catch (error) {
    const code =
      error instanceof Error &&
      ((error as Error & { code?: string }).code === "PDF_TOO_LARGE" ||
        error.message.toLowerCase().includes("max page"))
        ? "PDF_TOO_LARGE"
        : classifyPdfError(error);

    logPdfDiagnostics({
      result: "error",
      errorCode: code,
      fileSize: buffer.byteLength,
      durationMs: Date.now() - started,
      errorName: error instanceof Error ? error.name : "UnknownError",
      // Message truncated; never log PDF bytes or extracted text.
      errorMessage: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });

    return {
      success: false,
      text: "",
      pages: [],
      pageCount: 0,
      extractionMethod: "none",
      warnings: [USER_MESSAGES[code]],
      errorCode: code,
      userMessage: USER_MESSAGES[code],
    };
  }
}

export async function parsePdf(filename: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const limits = getPdfLimits();
  const extracted = await extractPdfText(buffer);
  const safeName = titleFromFilename(filename);

  if (extracted.errorCode === "PDF_NO_TEXT") {
    return {
      filename,
      title: safeName,
      mimeType: "application/pdf",
      extension: "pdf",
      content: "",
      summary: null,
      warnings: extracted.warnings,
      metadata: {
        pages: extracted.pageCount,
        pdfPages: [],
        extractionMethod: extracted.extractionMethod,
        errorCode: extracted.errorCode,
        // Multimodal vision OCR for PDF page rasters is not wired for uploads yet.
        ocrSupported: false,
        needsVisionOcr: true,
        scannedOrImageOnly: true,
      },
      extractionStatus: "empty",
    };
  }

  if (!extracted.success || extracted.errorCode) {
    return {
      filename,
      title: safeName,
      mimeType: "application/pdf",
      extension: "pdf",
      content: "",
      summary: null,
      warnings: extracted.warnings,
      metadata: {
        pages: extracted.pageCount || null,
        pdfPages: [],
        extractionMethod: extracted.extractionMethod,
        errorCode: extracted.errorCode,
        ocrSupported: false,
      },
      extractionStatus: "failed",
    };
  }

  const pdfPages = extracted.pages.length
    ? extracted.pages
    : splitPdfTextIntoPages(extracted.text, extracted.pageCount);

  const pageBlocks = pdfPages.map((p) => `## Page ${p.pageNumber}\n${p.text}`).join("\n\n");
  const { content, truncated } = truncateContent(
    pageBlocks || extracted.text,
    limits.maxCharacters,
  );
  const warnings = [...extracted.warnings];
  if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);

  return {
    filename,
    title: safeName,
    mimeType: "application/pdf",
    extension: "pdf",
    content,
    summary: null,
    warnings,
    metadata: {
      pages: extracted.pageCount || pdfPages.length,
      pdfPages,
      truncated,
      extractionMethod: extracted.extractionMethod,
      errorCode: null,
      ocrSupported: false,
    },
    extractionStatus: truncated ? "partial" : "success",
  };
}
