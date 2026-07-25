/**
 * Local Drive browser file-type icons (lucide names / categories).
 * No remote Google icon URLs.
 */

export type GoogleFileIconKind =
  | "folder"
  | "sheet"
  | "doc"
  | "slides"
  | "pdf"
  | "xlsx"
  | "csv"
  | "markdown"
  | "image"
  | "pptx"
  | "word"
  | "generic";

export function googleFileIconKind(mimeType: string, isFolder: boolean): GoogleFileIconKind {
  if (isFolder) return "folder";
  const mime = mimeType.toLowerCase();
  if (mime.includes("folder")) return "folder";
  if (mime === "application/vnd.google-apps.spreadsheet") return "sheet";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "xlsx";
  if (mime === "text/csv" || mime.endsWith("csv")) return "csv";
  if (mime === "application/vnd.google-apps.document") return "doc";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "word";
  if (mime === "application/vnd.google-apps.presentation") return "slides";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") {
    return "pptx";
  }
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime.startsWith("text/")) return "markdown";
  return "generic";
}
