import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r") i += 1;
      continue;
    }
    if (ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export function parseCsv(filename: string, text: string): ParsedKnowledgeDocument {
  const limits = getUploadLimits();
  const warnings: string[] = [];
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    warnings.push("CSV contained no rows.");
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "text/csv",
      extension: "csv",
      content: "",
      summary: null,
      warnings,
      metadata: { rowCount: 0 },
      extractionStatus: "empty",
    };
  }

  const limited = rows.slice(0, limits.maxRows);
  if (rows.length > limits.maxRows) {
    warnings.push(`CSV truncated to ${limits.maxRows} rows.`);
  }
  const headers = limited[0] ?? [];
  const body = limited.slice(1);
  const lines: string[] = [
    `# ${titleFromFilename(filename)}`,
    "",
    `Headers: ${headers.join(" | ")}`,
  ];
  for (let i = 0; i < body.length; i += 1) {
    const cells = (body[i] ?? []).map((value, idx) => {
      const header = headers[idx] || `col${idx + 1}`;
      return `${header}=${value.trim()}`;
    });
    lines.push(`Row ${i + 1}: ${cells.join("; ")}`);
  }
  const { content, truncated } = truncateContent(lines.join("\n"), limits.maxCharacters);
  if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);
  return {
    filename,
    title: titleFromFilename(filename),
    mimeType: "text/csv",
    extension: "csv",
    content,
    summary: null,
    warnings,
    metadata: {
      rowCount: rows.length,
      headerCount: headers.length,
      truncated: truncated || rows.length > limits.maxRows,
    },
    extractionStatus: warnings.length ? "partial" : "success",
  };
}
