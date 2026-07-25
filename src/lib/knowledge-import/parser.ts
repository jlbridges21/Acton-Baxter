import "server-only";

import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { parseCsv } from "./csv";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";
import { parseMarkdown, parsePlainText } from "./text";
import type { ParsedKnowledgeDocument } from "./types";
import {
  extensionOf,
  getUploadLimits,
  hashContentBuffer,
  isSupportedUploadExtension,
  titleFromFilename,
} from "./utils";
import { parseXlsx } from "./xlsx";

export async function parseKnowledgeUpload(input: {
  filename: string;
  buffer: Buffer;
  mimeType?: string | null;
}): Promise<ParsedKnowledgeDocument & { contentHash: string; sizeBytes: number }> {
  const filename = input.filename.trim() || "upload";
  const ext = extensionOf(filename);
  const limits = getUploadLimits();
  if (input.buffer.byteLength > limits.maxBytes) {
    throw new KnowledgeError(
      `This file exceeds the maximum size of ${Math.round(limits.maxBytes / (1024 * 1024))} MB.`,
      KNOWLEDGE_ERROR_CODES.UPLOAD_TOO_LARGE,
      { statusCode: 413 },
    );
  }
  if (!isSupportedUploadExtension(ext)) {
    throw new KnowledgeError(
      "This file type is not supported. Use .md, .txt, .pdf, .docx, .csv, .xlsx, .png, .jpg, .webp, or .pptx.",
      KNOWLEDGE_ERROR_CODES.UPLOAD_UNSUPPORTED,
      { statusCode: 415 },
    );
  }

  const contentHash = hashContentBuffer(input.buffer);
  let parsed: ParsedKnowledgeDocument;
  if (ext === "md" || ext === "markdown") {
    parsed = parseMarkdown(filename, input.buffer.toString("utf8"));
  } else if (ext === "txt") {
    parsed = parsePlainText(filename, input.buffer.toString("utf8"));
  } else if (ext === "csv") {
    parsed = parseCsv(filename, input.buffer.toString("utf8"));
  } else if (ext === "pdf") {
    parsed = await parsePdf(filename, input.buffer);
  } else if (ext === "docx") {
    parsed = await parseDocx(filename, input.buffer);
  } else if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
    parsed = await parseImageUpload(filename, input.buffer, ext);
  } else if (ext === "pptx") {
    parsed = await parsePptxUpload(filename, input.buffer);
  } else {
    parsed = parseXlsx(filename, input.buffer);
  }

  if (input.mimeType && !parsed.mimeType) {
    parsed.mimeType = input.mimeType;
  }

  return {
    ...parsed,
    contentHash,
    sizeBytes: input.buffer.byteLength,
  };
}

async function parseImageUpload(
  filename: string,
  buffer: Buffer,
  ext: string,
): Promise<ParsedKnowledgeDocument> {
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const { getBaxterVisionProvider } = await import("@/lib/baxter-ai/vision");
  const { unitsFromImageAnalysis } = await import("@/lib/knowledge-index/multimodal");
  const analysis = await getBaxterVisionProvider().analyzeImage({
    mimeType: mime,
    base64Data: buffer.toString("base64"),
    filename,
  });
  const units = unitsFromImageAnalysis({
    title: titleFromFilename(filename),
    analysis,
    mimeType: mime,
    filename,
  });
  return {
    filename,
    title: titleFromFilename(filename),
    mimeType: mime,
    extension: ext,
    content: units.map((u) => u.content).join("\n\n"),
    summary: analysis.description.slice(0, 240) || null,
    warnings: analysis.warnings,
    metadata: {
      imageUnits: units,
      documentType: analysis.documentType,
      extractedText: analysis.extractedText,
    },
    extractionStatus: units.length ? "success" : "empty",
  };
}

async function parsePptxUpload(filename: string, buffer: Buffer): Promise<ParsedKnowledgeDocument> {
  const { extractPptxSlides, unitsFromSlides } = await import("@/lib/knowledge-index/multimodal");
  const slides = extractPptxSlides(buffer);
  const units = unitsFromSlides({
    title: titleFromFilename(filename),
    slides,
  });
  return {
    filename,
    title: titleFromFilename(filename),
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
    content: units.map((u) => u.content).join("\n\n") || `Presentation: ${filename}`,
    summary: null,
    warnings: slides.length ? [] : ["No slide text could be extracted from this PPTX."],
    metadata: { slideUnits: units, slideCount: slides.length },
    extractionStatus: slides.length ? "success" : "partial",
  };
}
