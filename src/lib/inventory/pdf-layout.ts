import "server-only";

import { getDocumentProxy } from "unpdf";
import { OPS } from "unpdf/pdfjs";
import type { PdfPageLayout, PdfRect } from "./build-com-parse";
import { encodePng } from "./png";

function multiply(current: number[], next: number[]): number[] {
  const a = current[0] ?? 0;
  const b = current[1] ?? 0;
  const c = current[2] ?? 0;
  const d = current[3] ?? 0;
  const e = current[4] ?? 0;
  const f = current[5] ?? 0;
  const a2 = next[0] ?? 0;
  const b2 = next[1] ?? 0;
  const c2 = next[2] ?? 0;
  const d2 = next[3] ?? 0;
  const e2 = next[4] ?? 0;
  const f2 = next[5] ?? 0;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
  getAnnotations: () => Promise<
    Array<{ subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }>
  >;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: {
    get: (
      name: string,
      callback: (
        obj: { width?: number; height?: number; kind?: number; data?: Uint8Array } | null,
      ) => void,
    ) => void;
  };
};

function imageRect(ctm: number[]): PdfRect {
  const width = ctm[0] ?? 0;
  const height = ctm[3] ?? 0;
  const x = ctm[4] ?? 0;
  const y = ctm[5] ?? 0;
  return {
    x1: Math.min(x, x + width),
    y1: Math.min(y, y + height),
    x2: Math.max(x, x + width),
    y2: Math.max(y, y + height),
  };
}

async function pageImages(page: PdfPage): Promise<Array<{ rect: PdfRect; png: Buffer }>> {
  const ops = await page.getOperatorList();
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const found: Array<{ name: string; rect: PdfRect }> = [];
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    const fn = ops.fnArray[index];
    const args = ops.argsArray[index] ?? [];
    if (fn === OPS.save) stack.push([...ctm]);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = multiply(ctm, args as number[]);
    } else if (fn === OPS.paintImageXObject) {
      const rect = imageRect(ctm);
      const boxWidth = rect.x2 - rect.x1;
      const boxHeight = rect.y2 - rect.y1;
      if (boxWidth >= 40 && boxWidth <= 220 && boxHeight >= 40 && rect.x1 < 200) {
        found.push({ name: String(args[0] ?? ""), rect });
      }
    }
  }

  const images: Array<{ rect: PdfRect; png: Buffer }> = [];
  for (const image of found) {
    try {
      const obj = await new Promise<{
        width?: number;
        height?: number;
        kind?: number;
        data?: Uint8Array;
      } | null>((resolve) => page.objs.get(image.name, resolve));
      if (!obj?.data || !obj.width || !obj.height) continue;
      const channels = obj.kind === 3 ? 4 : obj.kind === 2 ? 3 : null;
      if (!channels) continue;
      const png = encodePng(obj.width, obj.height, obj.data, channels);
      if (png) images.push({ rect: image.rect, png });
    } catch {
      // A missing image never blocks the line-item import.
    }
  }
  return images;
}

export async function readBuildComPdfLayout(buffer: Buffer): Promise<PdfPageLayout[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: PdfPageLayout[] = [];
  const count = pdf.numPages ?? 0;
  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    const page = (await pdf.getPage(pageNumber)) as PdfPage;
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => {
      if (!item.str?.trim() || !item.transform) return [];
      return [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }];
    });
    const annotations = await page.getAnnotations();
    const links = annotations.flatMap((annotation) => {
      const url = annotation.url || annotation.unsafeUrl || "";
      const rect = annotation.rect;
      if (annotation.subtype !== "Link" || !url || !rect || rect.length < 4) return [];
      return [{ url, rect: { x1: rect[0]!, y1: rect[1]!, x2: rect[2]!, y2: rect[3]! } }];
    });
    let images: Array<{ rect: PdfRect; png: Buffer }> = [];
    try {
      images = await pageImages(page);
    } catch {
      images = [];
    }
    pages.push({ pageNumber, items, links, images });
  }
  return pages;
}
