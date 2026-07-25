import { createHash } from "node:crypto";
import type { KnowledgeUploadExtension } from "./types";
import { KNOWLEDGE_UPLOAD_EXTENSIONS } from "./types";

export function hashContentBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashContentText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function extensionOf(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function isSupportedUploadExtension(ext: string): ext is KnowledgeUploadExtension {
  return (KNOWLEDGE_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return base || filename;
}

export function getUploadLimits() {
  const maxMbRaw = Number(process.env.KNOWLEDGE_UPLOAD_MAX_MB ?? "20");
  const maxChars = Number(process.env.KNOWLEDGE_IMPORT_MAX_CHARACTERS ?? "200000");
  const maxRows = Number(process.env.KNOWLEDGE_IMPORT_MAX_ROWS ?? "500");
  const maxSheets = Number(process.env.KNOWLEDGE_IMPORT_MAX_SHEETS ?? "10");
  const maxMb = Number.isFinite(maxMbRaw) && maxMbRaw > 0 ? maxMbRaw : 20;
  return {
    maxBytes: maxMb * 1024 * 1024,
    maxCharacters: Math.max(1000, Number.isFinite(maxChars) ? maxChars : 200_000),
    maxRows: Math.max(10, Number.isFinite(maxRows) ? maxRows : 500),
    maxSheets: Math.max(1, Number.isFinite(maxSheets) ? maxSheets : 10),
  };
}

export function truncateContent(
  content: string,
  maxCharacters: number,
): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= maxCharacters) return { content, truncated: false };
  return {
    content: `${content.slice(0, maxCharacters)}\n\n[Truncated: content exceeded ${maxCharacters} characters.]`,
    truncated: true,
  };
}

export function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
