/**
 * Deterministic build.com / Ferguson Home order parser.
 * Numbers come from the PDF text layer. Vision is only a fallback upstream.
 */

import { z } from "zod";

export type PdfTextItem = { str: string; x: number; y: number };
export type PdfRect = { x1: number; y1: number; x2: number; y2: number };

export type PdfPageLayout = {
  pageNumber: number;
  items: PdfTextItem[];
  links: Array<{ url: string; rect: PdfRect }>;
  images: Array<{ rect: PdfRect; png: Buffer }>;
};

export type ParsedOrderLine = {
  itemName: string;
  sku: string;
  description: string | null;
  quantity: number | null;
  unitCostCents: number | null;
  lineTotalCents: number | null;
  productUrl: string | null;
  photoPng: Buffer | null;
  source: "text" | "vision";
  flags: string[];
  pageNumber: number;
};

export type ParsedBuildComOrder = {
  orderNumber: string | null;
  vendor: "build.com";
  lines: ParsedOrderLine[];
  source: "text" | "vision";
  correctionAttempted: boolean;
  textUsable: boolean;
  subtotalCents: number | null;
};

const moneySchema = z.number().int().nonnegative().nullable();

export const buildComLineSchema = z.object({
  itemName: z.string().trim().min(1).max(500),
  sku: z.string().trim().max(120),
  description: z.string().trim().max(500).nullable(),
  quantity: z.number().int().positive().nullable(),
  unitCostCents: moneySchema,
  lineTotalCents: moneySchema,
  productUrl: z.string().trim().max(2000).nullable(),
  source: z.enum(["text", "vision"]),
  flags: z.array(z.string()),
  pageNumber: z.number().int().positive(),
});

export const buildComOrderSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40).nullable(),
  vendor: z.literal("build.com"),
  lines: z.array(buildComLineSchema),
  source: z.enum(["text", "vision"]),
  correctionAttempted: z.boolean(),
  textUsable: z.boolean(),
  subtotalCents: moneySchema,
});

export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, fraction = ""] = cleaned.split(".");
  return (
    Number.parseInt(dollars || "0", 10) * 100 + Number.parseInt((fraction + "00").slice(0, 2), 10)
  );
}

function rowText(row: PdfTextItem[]): string {
  return row
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterRows(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items]
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const current = rows[rows.length - 1];
    const anchor = current?.[0];
    if (current && anchor && Math.abs(anchor.y - item.y) <= 1.6) current.push(item);
    else rows.push([item]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

function isProductLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "build.com" && host !== "fergusonhome.com") return false;
    return (
      parsed.pathname.length > 1 &&
      !parsed.pathname.startsWith("/support") &&
      !parsed.pathname.startsWith("/checkout")
    );
  } catch {
    return false;
  }
}

function intersectionArea(a: PdfRect, b: PdfRect): number {
  const width = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const height = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return width * height;
}

function normalizeRect(rect: PdfRect): PdfRect {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2),
  };
}

export function matchImageToLink(
  image: PdfRect,
  links: Array<{ url: string; rect: PdfRect }>,
): string | null {
  let best: { url: string; area: number } | null = null;
  const box = normalizeRect(image);
  for (const link of links) {
    if (!isProductLink(link.url)) continue;
    const area = intersectionArea(box, normalizeRect(link.rect));
    if (area <= 0) continue;
    if (!best || area > best.area) best = { url: link.url, area };
  }
  return best?.url ?? null;
}

function lineBand(nameY: number, priceY: number): PdfRect {
  const top = Math.max(nameY, priceY) + 18;
  const bottom = Math.min(nameY, priceY) - 28;
  return { x1: 0, y1: bottom, x2: 180, y2: top };
}

function attachMedia(
  line: { nameY: number; priceY: number },
  page: PdfPageLayout,
): { productUrl: string | null; photoPng: Buffer | null } {
  const band = lineBand(line.nameY, line.priceY);
  let productUrl: string | null = null;
  let bestLinkArea = 0;
  for (const link of page.links) {
    if (!isProductLink(link.url)) continue;
    const area = intersectionArea(band, normalizeRect(link.rect));
    if (area > bestLinkArea) {
      bestLinkArea = area;
      productUrl = link.url;
    }
  }
  let photoPng: Buffer | null = null;
  let bestImageArea = 0;
  for (const image of page.images) {
    const area = intersectionArea(band, normalizeRect(image.rect));
    if (area > bestImageArea && area > 200) {
      bestImageArea = area;
      photoPng = image.png;
    }
  }
  if (!productUrl) {
    for (const image of page.images) {
      const url = matchImageToLink(image.rect, page.links);
      if (!url) continue;
      const area = intersectionArea(band, normalizeRect(image.rect));
      if (area > bestImageArea) productUrl = url;
    }
  }
  return { productUrl, photoPng };
}

function flagLine(line: Omit<ParsedOrderLine, "flags">): string[] {
  const flags: string[] = [];
  if (!line.sku.trim()) flags.push("missing_sku");
  if (line.quantity == null) flags.push("missing_quantity");
  if (line.unitCostCents == null) flags.push("missing_unit_cost");
  if (
    line.quantity != null &&
    line.unitCostCents != null &&
    line.lineTotalCents != null &&
    line.quantity * line.unitCostCents !== line.lineTotalCents
  ) {
    flags.push("arithmetic_mismatch");
  }
  if (line.source === "vision") flags.push("vision");
  return flags;
}

function parsePage(page: PdfPageLayout, source: "text" | "vision"): ParsedOrderLine[] {
  const rows = clusterRows(page.items);
  const lines: ParsedOrderLine[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const text = rowText(row);
    if (!/^Model:/i.test(text)) continue;
    const sku = text.replace(/^Model:\s*/i, "").trim();
    const nameRow = rows[index - 1];
    const finishRow = rows[index + 1];
    const priceRow = rows[index + 2];
    if (!nameRow || !priceRow) continue;
    const nameParts = nameRow.filter((item) => item.x < 480).map((item) => item.str.trim());
    const itemName = nameParts.join(" ").replace(/\s+/g, " ").trim();
    if (!itemName || /^(subtotal|shipping|tax|grand total|order #)/i.test(itemName)) continue;
    const totalItem = nameRow.find((item) => item.x >= 480 && item.str.includes("$"));
    const finishText = finishRow ? rowText(finishRow) : "";
    const description = /^Color\/Finish:/i.test(finishText)
      ? finishText.replace(/^Color\/Finish:\s*/i, "").trim() || null
      : null;
    const priceText = rowText(priceRow);
    const unitMatch = priceText.match(/\$[\d,]+(?:\.\d{2})?/);
    const qtyMatch = priceText.match(/Qty\.\s*(\d+)/i);
    const nameY = nameRow[0]?.y ?? 0;
    const priceY = priceRow[0]?.y ?? nameY;
    const media = attachMedia({ nameY, priceY }, page);
    const draft = {
      itemName,
      sku,
      description,
      quantity: qtyMatch ? Number.parseInt(qtyMatch[1]!, 10) : null,
      unitCostCents: unitMatch ? dollarsToCents(unitMatch[0]) : null,
      lineTotalCents: totalItem ? dollarsToCents(totalItem.str) : null,
      productUrl: media.productUrl,
      photoPng: media.photoPng,
      source,
      pageNumber: page.pageNumber,
    };
    lines.push({ ...draft, flags: flagLine(draft) });
  }
  return lines;
}

function readOrderNumber(pages: PdfPageLayout[]): string | null {
  for (const page of pages) {
    const rows = clusterRows(page.items);
    for (const row of rows) {
      const text = rowText(row);
      const match = text.match(/Order\s*#\s*(\d{5,})/i);
      if (match) return match[1]!;
    }
    const flat = page.items.map((item) => item.str).join(" ");
    const loose = flat.match(/Order\s*#\s*(\d{5,})/i);
    if (loose) return loose[1]!;
  }
  return null;
}

function readSubtotal(pages: PdfPageLayout[]): number | null {
  for (const page of pages) {
    const rows = clusterRows(page.items);
    for (const row of rows) {
      const text = rowText(row);
      if (!/^Subtotal:/i.test(text)) continue;
      const money = text.match(/\$[\d,]+(?:\.\d{2})?/);
      if (money) return dollarsToCents(money[0]);
    }
  }
  return null;
}

export function textLayerIsUsable(pages: PdfPageLayout[]): boolean {
  const chars = pages.reduce(
    (sum, page) => sum + page.items.reduce((n, item) => n + item.str.length, 0),
    0,
  );
  if (chars < 80) return false;
  const flat = pages.map((page) => page.items.map((item) => item.str).join("\n")).join("\n");
  return /Model:/i.test(flat) && /Order\s*#/i.test(flat);
}

function buildOrder(
  pages: PdfPageLayout[],
  source: "text" | "vision",
  correctionAttempted: boolean,
): ParsedBuildComOrder {
  const lines = pages.flatMap((page) => parsePage(page, source));
  return {
    orderNumber: readOrderNumber(pages),
    vendor: "build.com",
    lines,
    source,
    correctionAttempted,
    textUsable: textLayerIsUsable(pages),
    subtotalCents: readSubtotal(pages),
  };
}

/**
 * Schema-check the structured parse. On failure, retry once by re-reading
 * the same text layer (self-correction) instead of inventing digits.
 */
export function extractBuildComOrderFromLayout(pages: PdfPageLayout[]): ParsedBuildComOrder {
  const first = buildOrder(pages, "text", false);
  const checked = buildComOrderSchema.safeParse({ ...first, lines: first.lines.map(stripPng) });
  if (checked.success && first.lines.length > 0 && first.orderNumber) return first;
  const second = buildOrder(pages, "text", true);
  const rechecked = buildComOrderSchema.safeParse({ ...second, lines: second.lines.map(stripPng) });
  if (!rechecked.success) {
    return {
      ...second,
      lines: second.lines.map((line) => ({
        ...line,
        flags: line.flags.includes("schema") ? line.flags : [...line.flags, "schema"],
      })),
    };
  }
  return second;
}

function stripPng(line: ParsedOrderLine) {
  const { photoPng: _photo, ...rest } = line;
  return rest;
}

export function arithmeticMismatch(
  line: Pick<ParsedOrderLine, "quantity" | "unitCostCents" | "lineTotalCents">,
): boolean {
  if (line.quantity == null || line.unitCostCents == null || line.lineTotalCents == null)
    return false;
  return line.quantity * line.unitCostCents !== line.lineTotalCents;
}

/** Vision fallback may run inline for a short scan, otherwise a background job. */
export function shouldQueueVisionImport(pageCount: number): boolean {
  return pageCount > 2;
}
