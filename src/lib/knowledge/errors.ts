import "server-only";

import { AppError } from "@/lib/errors";

export const KNOWLEDGE_ERROR_CODES = {
  NOT_FOUND: "KNOWLEDGE_ENTRY_NOT_FOUND",
  DELETE_BLOCKED: "KNOWLEDGE_ENTRY_DELETE_BLOCKED",
  HAS_REFERENCES: "KNOWLEDGE_ENTRY_HAS_REFERENCES",
  GOOGLE_MANAGED: "KNOWLEDGE_ENTRY_GOOGLE_MANAGED",
  STORAGE_DELETE_FAILED: "KNOWLEDGE_ENTRY_STORAGE_DELETE_FAILED",
  DELETE_FAILED: "KNOWLEDGE_ENTRY_DELETE_FAILED",
  UPLOAD_UNSUPPORTED: "KNOWLEDGE_UPLOAD_UNSUPPORTED_TYPE",
  UPLOAD_TOO_LARGE: "KNOWLEDGE_UPLOAD_TOO_LARGE",
  UPLOAD_PARSE_FAILED: "KNOWLEDGE_UPLOAD_PARSE_FAILED",
  UPLOAD_STORAGE_FAILED: "KNOWLEDGE_UPLOAD_STORAGE_FAILED",
  UPLOAD_EMPTY: "KNOWLEDGE_UPLOAD_EMPTY_EXTRACTION",
  UPLOAD_DUPLICATE: "KNOWLEDGE_UPLOAD_DUPLICATE",
} as const;

export class KnowledgeError extends AppError {
  constructor(message: string, code: string, options?: { statusCode?: number; cause?: unknown }) {
    super(message, {
      code,
      statusCode: options?.statusCode ?? 400,
      expose: true,
      cause: options?.cause,
    });
    this.name = "KnowledgeError";
  }
}
