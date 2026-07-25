import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

export function parsePlainText(filename: string, text: string): ParsedKnowledgeDocument {
  const limits = getUploadLimits();
  const { content, truncated } = truncateContent(text, limits.maxCharacters);
  const warnings: string[] = [];
  if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);
  const extractionStatus = content.trim() ? (truncated ? "partial" : "success") : "empty";
  if (!content.trim()) {
    warnings.push("No text content was found in this file.");
  }
  return {
    filename,
    title: titleFromFilename(filename),
    mimeType: "text/plain",
    extension: "txt",
    content,
    summary: null,
    warnings,
    metadata: { truncated },
    extractionStatus,
  };
}

export function parseMarkdown(filename: string, text: string): ParsedKnowledgeDocument {
  const parsed = parsePlainText(filename, text);
  return {
    ...parsed,
    mimeType: "text/markdown",
    extension: filename.toLowerCase().endsWith(".markdown") ? "markdown" : "md",
  };
}
