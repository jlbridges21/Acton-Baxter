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
      "This file type is not supported. Use .md, .txt, .pdf, .docx, .csv, or .xlsx.",
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
