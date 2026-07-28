import "server-only";

import { createHash } from "node:crypto";
import { downloadDriveFileBytes, exportDriveFile } from "./drive";
import {
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  GOOGLE_SLIDES_MIME,
  type GoogleDriveFile,
  type ParsedGoogleDocument,
} from "./types";

const PDF_MIME = "application/pdf";
const TEXT_MIME = "text/plain";
const MARKDOWN_MIME = "text/markdown";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CSV_MIME = "text/csv";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPT_MIME = "application/vnd.ms-powerpoint";
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isSupportedGoogleMime(mimeType: string): boolean {
  return (
    mimeType === GOOGLE_DOC_MIME ||
    mimeType === GOOGLE_SHEET_MIME ||
    mimeType === GOOGLE_SLIDES_MIME ||
    mimeType === TEXT_MIME ||
    mimeType === MARKDOWN_MIME ||
    mimeType === PDF_MIME ||
    mimeType === DOCX_MIME ||
    mimeType === CSV_MIME ||
    mimeType === XLSX_MIME ||
    mimeType === XLS_MIME ||
    mimeType === PPTX_MIME ||
    mimeType === PPT_MIME ||
    IMAGE_MIMES.has(mimeType) ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("text/")
  );
}

export function unsupportedMimeReason(mimeType: string): string {
  if (mimeType.includes("video/")) return "Video files are not indexed automatically.";
  if (mimeType.includes("audio/")) return "Audio files are not indexed automatically.";
  if (mimeType.includes("zip") || mimeType.includes("compressed")) {
    return "Archive files are not indexed automatically.";
  }
  return `This file type (${mimeType || "unknown"}) cannot be indexed automatically yet.`;
}

/**
 * Parse a Drive file into searchable text when possible.
 * Binary Office/PDF/CSV/XLSX/images/slides: download bytes and reuse parsers.
 */
export async function parseGoogleDriveFile(
  file: GoogleDriveFile,
  folderId: string | null,
): Promise<ParsedGoogleDocument> {
  const owner = file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || null;
  const base = {
    fileId: file.id,
    title: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    owner,
    folderId,
  };

  if (file.mimeType === GOOGLE_DOC_MIME) {
    try {
      const html = await exportDriveFile(file.id, "text/html");
      const structured = htmlToStructuredText(html, file.name);
      return {
        ...base,
        contentText: structured,
        contentHash: hashContent(structured),
        parseMode: "full_text",
      };
    } catch {
      const contentText = await exportDriveFile(file.id, "text/plain");
      return {
        ...base,
        contentText,
        contentHash: hashContent(contentText),
        parseMode: "full_text",
      };
    }
  }

  if (file.mimeType === GOOGLE_SHEET_MIME) {
    const { exportGoogleSheetStructured } = await import("./sheets");
    const structured = await exportGoogleSheetStructured(file.id);
    return {
      ...base,
      contentText: structured.contentText,
      contentHash: hashContent(structured.contentText),
      parseMode: "full_text",
      workbook: structured.workbook,
    };
  }

  if (file.mimeType === GOOGLE_SLIDES_MIME) {
    try {
      const contentText = await exportDriveFile(file.id, "text/plain");
      const slides = contentText
        .split(/\n(?=Slide\s+\d+)/i)
        .map((block, index) => {
          const text = block.trim();
          return {
            slideNumber: index + 1,
            text,
            title: text.split("\n")[0]?.slice(0, 120),
          };
        })
        .filter((s) => s.text.length > 0);
      const { unitsFromSlides } = await import("@/lib/knowledge-index/multimodal");
      const units = unitsFromSlides({
        title: file.name,
        slides,
        sourceUrl: file.webViewLink,
      });
      const assembled =
        units.map((u) => u.content).join("\n\n") || contentText || `Presentation: ${file.name}`;
      return {
        ...base,
        contentText: assembled,
        contentHash: hashContent(assembled),
        parseMode: "full_text",
        slideUnits: units,
      };
    } catch (error) {
      const stub = [
        `Title: ${file.name}`,
        "Google Slides export failed. Open the original presentation.",
        error instanceof Error ? error.message.slice(0, 200) : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ...base,
        contentText: stub,
        contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}`),
        parseMode: "metadata_only",
      };
    }
  }

  if (
    file.mimeType === TEXT_MIME ||
    file.mimeType === MARKDOWN_MIME ||
    file.mimeType.startsWith("text/")
  ) {
    const { googleFetch } = await import("./auth");
    const contentText = await googleFetch<string>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
      { rawText: true },
    );
    return {
      ...base,
      contentText,
      contentHash: hashContent(contentText),
      parseMode: "full_text",
    };
  }

  if (IMAGE_MIMES.has(file.mimeType) || file.mimeType.startsWith("image/")) {
    try {
      const buffer = await downloadDriveFileBytes(file.id);
      const maxBytes = 8 * 1024 * 1024;
      if (buffer.byteLength > maxBytes) {
        return {
          ...base,
          contentText: `Needs attention — file exceeds automatic processing limit (${Math.round(buffer.byteLength / 1024 / 1024)}MB).`,
          contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}:oversized`),
          parseMode: "metadata_only",
          imageMeta: {
            mimeType: file.mimeType,
            filename: file.name,
            oversized: true,
          },
        };
      }
      const { getBaxterVisionProvider } = await import("@/lib/baxter-ai/vision");
      const { unitsFromImageAnalysis } = await import("@/lib/knowledge-index/multimodal");
      const analysis = await getBaxterVisionProvider().analyzeImage({
        mimeType: file.mimeType,
        base64Data: buffer.toString("base64"),
        filename: file.name,
      });
      const units = unitsFromImageAnalysis({
        title: file.name,
        analysis,
        sourceUrl: file.webViewLink,
        mimeType: file.mimeType,
        filename: file.name,
      });
      const contentText = units.map((u) => u.content).join("\n\n");
      return {
        ...base,
        contentText,
        contentHash: hashContent(contentText || `${file.id}:${file.md5Checksum ?? ""}`),
        parseMode: "full_text",
        imageUnits: units,
        imageMeta: {
          mimeType: file.mimeType,
          filename: file.name,
          documentType: analysis.documentType,
          warnings: analysis.warnings,
        },
      };
    } catch (error) {
      return {
        ...base,
        contentText: `Image analysis failed for ${file.name}. ${error instanceof Error ? error.message : ""}`,
        contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}`),
        parseMode: "metadata_only",
      };
    }
  }

  if (file.mimeType === PPTX_MIME || file.mimeType === PPT_MIME) {
    try {
      const buffer = await downloadDriveFileBytes(file.id);
      const { extractPptxSlides, unitsFromSlides } =
        await import("@/lib/knowledge-index/multimodal");
      const slides = extractPptxSlides(buffer);
      const units = unitsFromSlides({
        title: file.name,
        slides,
        sourceUrl: file.webViewLink,
      });
      const contentText = units.map((u) => u.content).join("\n\n") || `Presentation: ${file.name}`;
      return {
        ...base,
        contentText,
        contentHash: hashContent(contentText),
        parseMode: "full_text",
        slideUnits: units,
      };
    } catch (error) {
      return {
        ...base,
        contentText: `PowerPoint extraction failed. ${error instanceof Error ? error.message : ""}`,
        contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}`),
        parseMode: "metadata_only",
      };
    }
  }

  if (
    file.mimeType === XLSX_MIME ||
    file.mimeType === XLS_MIME ||
    file.mimeType === CSV_MIME ||
    file.mimeType === PDF_MIME ||
    file.mimeType === DOCX_MIME
  ) {
    try {
      const buffer = await downloadDriveFileBytes(file.id);
      const { parseKnowledgeUpload } = await import("@/lib/knowledge-import/parser");
      const filename = file.name.includes(".")
        ? file.name
        : `${file.name}${
            file.mimeType === XLSX_MIME || file.mimeType === XLS_MIME
              ? ".xlsx"
              : file.mimeType === CSV_MIME
                ? ".csv"
                : file.mimeType === PDF_MIME
                  ? ".pdf"
                  : ".docx"
          }`;
      const parsed = await parseKnowledgeUpload({
        filename,
        buffer,
        mimeType: file.mimeType,
      });

      if (parsed.extractionStatus === "failed" || parsed.extractionStatus === "unsupported") {
        const reason =
          parsed.warnings[0] ??
          "Content extraction failed. Open the original file for full content.";
        return {
          ...base,
          contentText: [`Title: ${file.name}`, `Type: ${file.mimeType}`, reason]
            .filter(Boolean)
            .join("\n"),
          contentHash: hashContent(
            `${file.id}:${file.modifiedTime ?? ""}:${file.md5Checksum ?? ""}`,
          ),
          parseMode: "metadata_only",
          pdfPages: undefined,
        };
      }

      if (parsed.extractionStatus === "empty" || !parsed.content.trim()) {
        return {
          ...base,
          contentText: [
            `Title: ${file.name}`,
            `Type: ${file.mimeType}`,
            parsed.warnings[0] ??
              "No selectable text was found. This may be a scanned or image-only PDF.",
          ].join("\n"),
          contentHash: parsed.contentHash || hashContent(parsed.content || file.id),
          parseMode: "metadata_only",
          pdfPages: [],
        };
      }

      return {
        ...base,
        contentText: parsed.content,
        contentHash: parsed.contentHash || hashContent(parsed.content),
        parseMode: "full_text",
        pdfPages: parsed.metadata?.pdfPages as
          Array<{ pageNumber: number; text: string }> | undefined,
      };
    } catch (error) {
      const stub = [
        `Title: ${file.name}`,
        `Type: ${file.mimeType}`,
        "Content extraction failed. Open the original file for full content.",
        file.webViewLink ? `URL: ${file.webViewLink}` : "",
        // Keep message generic — do not forward raw parser/runtime exceptions to indexed text.
        error instanceof Error && /password/i.test(error.message)
          ? "This PDF is password protected and Baxter can't read it."
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ...base,
        contentText: stub,
        contentHash: hashContent(`${file.id}:${file.modifiedTime ?? ""}:${file.md5Checksum ?? ""}`),
        parseMode: "metadata_only",
      };
    }
  }

  return {
    ...base,
    contentText: unsupportedMimeReason(file.mimeType),
    contentHash: hashContent(`${file.id}:${file.mimeType}:${file.modifiedTime ?? ""}`),
    parseMode: "unsupported",
  };
}

function htmlToStructuredText(html: string, title: string): string {
  const parts: string[] = [`Document: ${title}`];
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  const blocks: string[] = [];
  while ((match = headingRe.exec(cleaned)) !== null) {
    const before = cleaned.slice(lastIndex, match.index);
    const beforeText = stripTags(before).trim();
    if (beforeText) blocks.push(beforeText);
    blocks.push(`${"#".repeat(Number(match[1]))} ${stripTags(match[2] ?? "").trim()}`);
    lastIndex = match.index + match[0].length;
  }
  const tail = stripTags(cleaned.slice(lastIndex)).trim();
  if (tail) blocks.push(tail);

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  let tableIndex = 0;
  while ((tableMatch = tableRe.exec(cleaned)) !== null) {
    tableIndex += 1;
    const rows = Array.from(tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((row) =>
      Array.from(row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((c) => stripTags(c[1] ?? "").trim())
        .filter(Boolean)
        .join(" | "),
    );
    if (rows.length) {
      blocks.push(`## Table ${tableIndex}\n${rows.join("\n")}`);
    }
  }

  parts.push(...blocks.filter(Boolean));
  return parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function googleSourceKind(mimeType: string): "google_doc" | "google_sheet" | "google_file" {
  if (mimeType === GOOGLE_DOC_MIME) return "google_doc";
  if (mimeType === GOOGLE_SHEET_MIME) return "google_sheet";
  return "google_file";
}

export function googleOpenLabel(mimeType: string): string {
  if (mimeType === GOOGLE_DOC_MIME) return "Open Google Doc";
  if (mimeType === GOOGLE_SHEET_MIME) return "Open Google Sheet";
  if (mimeType === GOOGLE_SLIDES_MIME) return "Open Google Slides";
  if (mimeType === XLSX_MIME || mimeType === XLS_MIME) return "Open spreadsheet";
  if (mimeType === PDF_MIME) return "Open PDF";
  if (mimeType.startsWith("image/")) return "Open image";
  if (mimeType === PPTX_MIME || mimeType === PPT_MIME) return "Open presentation";
  return "Open Google File";
}
