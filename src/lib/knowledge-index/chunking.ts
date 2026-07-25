import { createHash } from "node:crypto";
import type { KnowledgeUnitType } from "./types";
import { KNOWLEDGE_INDEX_VERSION } from "./types";

export type DraftUnit = {
  unit_type: KnowledgeUnitType;
  ordinal: number;
  title: string | null;
  content: string;
  search_text: string;
  structured_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  content_hash: string;
  index_version: number;
};

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Structural document chunking — prefer headings and paragraph groups.
 */
export function chunkDocumentContent(input: {
  title: string;
  content: string;
  sourceType?: string;
}): DraftUnit[] {
  const text = input.content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const sections: Array<{ heading: string | null; body: string }> = [];
  const headingSplit = text.split(/\n(?=#{1,6}\s+)/);
  if (headingSplit.length > 1 || /^#{1,6}\s+/m.test(text)) {
    for (const part of headingSplit) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(#{1,6})\s+(.+?)\n([\s\S]*)$/);
      if (match) {
        sections.push({ heading: match[2]!.trim(), body: match[3]!.trim() });
      } else {
        sections.push({ heading: null, body: trimmed });
      }
    }
  } else {
    // Paragraph groups of ~2–4 paragraphs / ~1200 chars
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    let buf: string[] = [];
    let len = 0;
    for (const p of paragraphs) {
      if (buf.length && len + p.length > 1200) {
        sections.push({ heading: null, body: buf.join("\n\n") });
        buf = [];
        len = 0;
      }
      buf.push(p);
      len += p.length;
      if (buf.length >= 4) {
        sections.push({ heading: null, body: buf.join("\n\n") });
        buf = [];
        len = 0;
      }
    }
    if (buf.length) sections.push({ heading: null, body: buf.join("\n\n") });
  }

  return sections.map((section, index) => {
    const content = [
      `Document: ${input.title}`,
      section.heading ? `Section: ${section.heading}` : null,
      "",
      section.body,
    ]
      .filter((l) => l !== null)
      .join("\n");
    return {
      unit_type: section.heading ? "document_section" : "paragraph",
      ordinal: index,
      title: section.heading,
      content,
      search_text: content,
      structured_data: {},
      metadata: { documentTitle: input.title },
      content_hash: hashContent(content),
      index_version: KNOWLEDGE_INDEX_VERSION,
    };
  });
}

export function unitsFromWorkbook(
  workbook: import("./types").ParsedWorkbook,
  entryMeta?: { sourceUrl?: string | null; googleFileId?: string | null },
): DraftUnit[] {
  const units: DraftUnit[] = [];
  let ordinal = 0;

  for (const sheet of workbook.sheets) {
    units.push({
      unit_type: "spreadsheet_sheet",
      ordinal: ordinal++,
      title: sheet.name,
      content: `Sheet: ${sheet.name}`,
      search_text: `${workbook.title} ${sheet.name}`,
      structured_data: {
        sheetName: sheet.name,
        sheetGid: sheet.gid,
        tableCount: sheet.tables.length,
        rowCounts: sheet.tables.map((t) => t.rows.length),
      },
      metadata: {
        sheetName: sheet.name,
        sheetGid: sheet.gid,
        sourceUrl: entryMeta?.sourceUrl ?? null,
        googleFileId: entryMeta?.googleFileId ?? null,
        warnings: sheet.warnings,
      },
      content_hash: hashContent(`${sheet.name}:${sheet.tables.length}`),
      index_version: KNOWLEDGE_INDEX_VERSION,
    });

    for (const note of sheet.notes) {
      units.push({
        unit_type: "note",
        ordinal: ordinal++,
        title: `${sheet.name} note`,
        content: note,
        search_text: note,
        structured_data: { sheetName: sheet.name },
        metadata: { sheetName: sheet.name },
        content_hash: hashContent(note),
        index_version: KNOWLEDGE_INDEX_VERSION,
      });
    }

    for (const summary of sheet.summaryMetrics) {
      units.push({
        unit_type: "summary_metrics",
        ordinal: ordinal++,
        title: `${sheet.name} summary`,
        content: summary.displayLines,
        search_text: summary.searchText,
        structured_data: {
          sheetName: sheet.name,
          metrics: Object.fromEntries(Object.entries(summary.metrics).map(([k, v]) => [k, v])),
        },
        metadata: { sheetName: sheet.name, sheetGid: sheet.gid },
        content_hash: hashContent(summary.displayLines),
        index_version: KNOWLEDGE_INDEX_VERSION,
      });
    }

    for (const table of sheet.tables) {
      units.push({
        unit_type: "table",
        ordinal: ordinal++,
        title: `${sheet.name} table`,
        content: `Headers: ${table.headers.join(" | ")}\nRows: ${table.rows.length}`,
        search_text: `${sheet.name} ${table.headers.join(" ")}`,
        structured_data: {
          tableId: table.id,
          headers: table.headers,
          headerRowIndex: table.headerRowIndex,
          rowCount: table.rows.length,
          priority: table.priority,
        },
        metadata: {
          sheetName: sheet.name,
          sheetGid: sheet.gid,
          tableId: table.id,
          priority: table.priority,
        },
        content_hash: hashContent(table.id),
        index_version: KNOWLEDGE_INDEX_VERSION,
      });

      for (const row of table.rows) {
        const entityGuess =
          row.values["Customer Name"]?.display ||
          row.values["Project"]?.display ||
          Object.values(row.values).find((v) => v.display)?.display ||
          `Row ${row.rowNumber}`;
        units.push({
          unit_type: "spreadsheet_row",
          ordinal: ordinal++,
          title: String(entityGuess),
          content: row.displayLines,
          search_text: row.searchText,
          structured_data: {
            sheetName: row.sheetName,
            sheetGid: row.sheetGid,
            tableId: row.tableId,
            rowNumber: row.rowNumber,
            priority: row.priority,
            values: row.values,
          },
          metadata: {
            sheetName: row.sheetName,
            sheetGid: row.sheetGid,
            tableId: row.tableId,
            rowNumber: row.rowNumber,
            priority: row.priority,
            sourceUrl: entryMeta?.sourceUrl ?? null,
            googleFileId: entryMeta?.googleFileId ?? null,
          },
          content_hash: hashContent(row.displayLines),
          index_version: KNOWLEDGE_INDEX_VERSION,
        });
      }
    }
  }

  return units;
}
