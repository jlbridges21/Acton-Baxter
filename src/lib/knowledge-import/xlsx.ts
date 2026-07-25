import * as XLSX from "xlsx";
import type { ParsedKnowledgeDocument } from "./types";
import { getUploadLimits, titleFromFilename, truncateContent } from "./utils";

export function parseXlsx(filename: string, buffer: Buffer): ParsedKnowledgeDocument {
  const limits = getUploadLimits();
  const warnings: string[] = [];
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetNames = workbook.SheetNames.slice(0, limits.maxSheets);
    if (workbook.SheetNames.length > limits.maxSheets) {
      warnings.push(`Workbook truncated to ${limits.maxSheets} sheets.`);
    }
    if (sheetNames.length === 0) {
      warnings.push("Workbook contained no sheets.");
      return {
        filename,
        title: titleFromFilename(filename),
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
        content: "",
        summary: null,
        warnings,
        metadata: { sheetCount: 0 },
        extractionStatus: "empty",
      };
    }

    const lines: string[] = [`# ${titleFromFilename(filename)}`];
    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as unknown as unknown[][];
      const limited = rows.slice(0, limits.maxRows);
      if (rows.length > limits.maxRows) {
        warnings.push(`Sheet “${name}” truncated to ${limits.maxRows} rows.`);
      }
      lines.push("", `## Sheet: ${name}`);
      if (limited.length === 0) {
        lines.push("(empty sheet)");
        continue;
      }
      const headers = (limited[0] ?? []).map((cell) => String(cell ?? "").trim());
      lines.push(`Headers: ${headers.join(" | ")}`);
      for (let i = 1; i < limited.length; i += 1) {
        const row = limited[i] ?? [];
        const cells = row.slice(0, 40).map((cell, idx) => {
          const header = headers[idx] || `col${idx + 1}`;
          return `${header}=${String(cell ?? "").trim()}`;
        });
        lines.push(`Row ${i}: ${cells.join("; ")}`);
      }
    }

    const { content, truncated } = truncateContent(lines.join("\n"), limits.maxCharacters);
    if (truncated) warnings.push(`Content truncated to ${limits.maxCharacters} characters.`);
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
      content,
      summary: null,
      warnings,
      metadata: {
        sheetNames,
        sheetCount: workbook.SheetNames.length,
        truncated: truncated || workbook.SheetNames.length > limits.maxSheets,
      },
      extractionStatus: content.trim() ? (warnings.length ? "partial" : "success") : "empty",
    };
  } catch (error) {
    warnings.push(
      error instanceof Error ? `XLSX parse failed: ${error.message}` : "XLSX parse failed.",
    );
    return {
      filename,
      title: titleFromFilename(filename),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
      content: "",
      summary: null,
      warnings,
      metadata: {},
      extractionStatus: "failed",
    };
  }
}
