export type KnowledgeExtractionStatus = "success" | "partial" | "empty" | "unsupported" | "failed";

export type ParsedKnowledgeDocument = {
  filename: string;
  title: string;
  mimeType: string;
  extension: string;
  content: string;
  summary?: string | null;
  warnings: string[];
  metadata: Record<string, unknown>;
  extractionStatus: KnowledgeExtractionStatus;
};

export const KNOWLEDGE_UPLOAD_EXTENSIONS = [
  "md",
  "markdown",
  "txt",
  "pdf",
  "docx",
  "csv",
  "xlsx",
] as const;

export type KnowledgeUploadExtension = (typeof KNOWLEDGE_UPLOAD_EXTENSIONS)[number];

export const KNOWLEDGE_UPLOAD_BUCKET = "knowledge-uploads";
