import mammoth from "mammoth";
import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

export async function parseDocx(
  filename: string,
  buffer: Buffer,
): Promise<ParsedKnowledgeDocument> {
  const limits = getUploadLimits();
  const warnings: string[] = [];
  try {
    const result = await mammoth.extractRawText({ buffer });
    for (const message of result.messages ?? []) {
      if (message.message) warnings.push(message.message);
    }
    const raw = (result.value ?? "").trim();
    if (!raw) {
      warnings.push("No text content was extracted from this Word document.");
      return {
        filename,
        title: titleFromFilename(filename),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
        content: "",
        summary: null,
        warnings,
        metadata: {},
        extractionStatus: "empty",
      };
    }
    const { content, truncated } = truncateContent(raw, limits.maxCharacters);
    if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: "docx",
      content,
      summary: null,
      warnings,
      metadata: { truncated },
      extractionStatus: truncated ? "partial" : "success",
    };
  } catch (error) {
    warnings.push(
      error instanceof Error ? `DOCX parse failed: ${error.message}` : "DOCX parse failed.",
    );
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: "docx",
      content: "",
      summary: null,
      warnings,
      metadata: {},
      extractionStatus: "failed",
    };
  }
}
