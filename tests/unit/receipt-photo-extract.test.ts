/**
 * Receipt photo capture + extraction + PWA — unit tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import { parseAmountToCents } from "@/lib/receipts/amount";
import {
  drawOrientedImage,
  orientedDimensions,
  readJpegExifOrientation,
  scaleToMaxEdge,
  RECEIPT_IMAGE_MAX_EDGE,
} from "@/lib/receipts/client-image";
import {
  RECEIPT_EXTRACTION_PROMPT,
  buildReceiptExtractionPrompt,
  receiptExtractionSchema,
  extractionHasUsableFields,
  isLowConfidence,
} from "@/lib/receipts/extraction-schema";
import { extractReceiptFromStoragePath, extractionToFormPrefill } from "@/lib/receipts/extract";
import {
  createCustomExpenseJob,
  createReceipt,
  findRecentDuplicateReceipt,
  resetReceiptLogMemoryForTests,
} from "@/lib/receipts/store";
import {
  downloadReceiptPhoto,
  resetReceiptPhotosMemoryForTests,
  sniffVisionSafeImageMime,
  uploadReceiptPhoto,
} from "@/lib/receipts/storage";
import {
  setBaxterVisionProviderForTests,
  type BaxterVisionProvider,
  type ImageAnalysisResult,
} from "@/lib/baxter-ai/vision";

/** Minimal valid JPEG (1x1) SOI+APP0+SOF+SOS+EOI — no EXIF. */
function minimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0x7f, 0xff, 0xd9,
  ]);
}

/** JPEG with EXIF orientation = 6 (portrait phone). */
function jpegWithExifOrientation6(): Buffer {
  // Build APP1 with little-endian TIFF IFD containing Orientation=6
  const exifBody = Buffer.alloc(100);
  // "Exif\0\0"
  exifBody.write("Exif\0\0", 0, "binary");
  // TIFF header II
  exifBody.writeUInt16LE(0x4949, 6);
  exifBody.writeUInt16LE(0x002a, 8);
  exifBody.writeUInt32LE(8, 10); // offset to IFD from TIFF start (=6+8? TIFF starts at 6)
  // IFD at offset 8 from TIFF start → absolute 6+8=14
  const ifd = 14;
  exifBody.writeUInt16LE(1, ifd); // 1 entry
  // Entry: tag 0x0112, type SHORT (3), count 1, value 6
  exifBody.writeUInt16LE(0x0112, ifd + 2);
  exifBody.writeUInt16LE(3, ifd + 4);
  exifBody.writeUInt32LE(1, ifd + 6);
  exifBody.writeUInt16LE(6, ifd + 10);
  exifBody.writeUInt16LE(0, ifd + 12); // next IFD

  const app1Length = exifBody.length + 2;
  const app1 = Buffer.alloc(2 + 2 + exifBody.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(app1Length, 2);
  exifBody.copy(app1, 4);

  const rest = minimalJpeg().subarray(2); // drop SOI, we'll prepend
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, rest]);
}

function extractionFixture(overrides: Record<string, unknown> = {}) {
  return {
    amountCents: 4599,
    vendor: "Home Depot",
    purchasedOn: "2026-03-12",
    items: "Screws",
    description: null,
    lineItemAmountsCents: [],
    crossCheckAmountsCents: [],
    confidence: {
      amount: 0.92,
      vendor: 0.95,
      purchasedOn: 0.88,
      items: 0.7,
      description: 0,
    },
    warnings: [],
    ...overrides,
  };
}

describe("receipt image pipeline helpers", () => {
  it("reads EXIF orientation 6 from portrait JPEG", () => {
    expect(readJpegExifOrientation(jpegWithExifOrientation6())).toBe(6);
  });

  it("returns orientation 1 for JPEG without EXIF", () => {
    expect(readJpegExifOrientation(minimalJpeg())).toBe(1);
  });

  it("swaps dimensions for orientation 6 and scales long edge", () => {
    // Portrait phone sensor buffer often 3024x4032 with orientation 6 → display 4032x3024
    const oriented = orientedDimensions(3024, 4032, 6);
    expect(oriented).toEqual({ width: 4032, height: 3024 });
    const scaled = scaleToMaxEdge(oriented.width, oriented.height, RECEIPT_IMAGE_MAX_EDGE);
    expect(Math.max(scaled.width, scaled.height)).toBe(RECEIPT_IMAGE_MAX_EDGE);
    expect(scaled.width).toBe(1800);
    expect(scaled.height).toBe(Math.round(3024 * (1800 / 4032)));
  });

  it("applies orientation 6 transform on a mock canvas context", () => {
    const calls: string[] = [];
    const ctx = {
      translate: (...args: number[]) => calls.push(`translate:${args.join(",")}`),
      rotate: (r: number) => calls.push(`rotate:${r}`),
      scale: (...args: number[]) => calls.push(`scale:${args.join(",")}`),
      drawImage: () => calls.push("drawImage"),
    } as unknown as CanvasRenderingContext2D;
    drawOrientedImage(ctx, {} as CanvasImageSource, 100, 200, 6);
    expect(calls.some((c) => c.startsWith("rotate:"))).toBe(true);
    expect(calls).toContain("drawImage");
  });

  it("rejects HEIC magic with actionable error and accepts JPEG", () => {
    expect(sniffVisionSafeImageMime(minimalJpeg())).toBe("image/jpeg");
    const heic = Buffer.from("....ftypheic....");
    expect(() => sniffVisionSafeImageMime(heic)).toThrow(/HEIC/i);
  });
});

describe("amount cents across formats", () => {
  it("handles currency, thousands separators, and plain dollars", () => {
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
    expect(parseAmountToCents("1,234.56")).toBe(123456);
    expect(parseAmountToCents("42.50")).toBe(4250);
    expect(parseAmountToCents("$10")).toBe(1000);
  });
});

describe("extraction schema + prompt", () => {
  it("embeds total, per-unit, date-literal, and arithmetic rules", () => {
    const prompt = buildReceiptExtractionPrompt({ now: new Date("2026-09-17T12:00:00.000Z") });
    expect(prompt).toContain("Today's date for reference is 2026-09-17");
    expect(prompt).toContain("Transcribe the printed year literally and exactly as shown");
    expect(prompt).toContain("PER-UNIT PRICE IS NEVER THE AMOUNT");
    expect(prompt).toContain("ARITHMETIC SELF-CHECK");
    expect(prompt).toContain("PLEASE PAY THIS AMOUNT");
    expect(prompt).toContain("grabbing the subtotal is a common receipt-OCR error");
    expect(prompt).not.toContain('not "amount due" on an unpaid invoice');
    // Static export still present for older imports
    expect(RECEIPT_EXTRACTION_PROMPT).toContain("PER-UNIT PRICE IS NEVER THE AMOUNT");
  });

  it("validates extraction and flags low confidence", () => {
    const ok = receiptExtractionSchema.parse(extractionFixture());
    expect(ok.amountCents).toBe(4599);
    expect(extractionHasUsableFields(ok)).toBe(true);
    expect(isLowConfidence(0.4)).toBe(true);
    expect(isLowConfidence(0.9)).toBe(false);

    const tipAmbiguous = receiptExtractionSchema.parse(
      extractionFixture({
        amountCents: 5800,
        confidence: {
          amount: 0.5,
          vendor: 0.9,
          purchasedOn: 0.9,
          items: 0.2,
          description: 0,
        },
        warnings: ["Handwritten tip; used printed total"],
      }),
    );
    expect(tipAmbiguous.amountCents).toBe(5800);
    expect(isLowConfidence(tipAmbiguous.confidence.amount)).toBe(true);

    const illegibleDate = receiptExtractionSchema.parse(
      extractionFixture({
        purchasedOn: null,
        confidence: {
          amount: 0.9,
          vendor: 0.9,
          purchasedOn: 0.1,
          items: 0,
          description: 0,
        },
      }),
    );
    expect(illegibleDate.purchasedOn).toBeNull();
  });

  it("prefills form dollars from integer cents", () => {
    const prefill = extractionToFormPrefill(
      receiptExtractionSchema.parse(extractionFixture({ amountCents: 123456 })),
    );
    expect(prefill.amount).toBe("1234.56");
  });
});

describe("upload-before-extract + vision scenarios", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    resetReceiptPhotosMemoryForTests();
    setBaxterVisionProviderForTests(null);
  });

  it("stores photo even when extraction fails, then form can proceed", async () => {
    const failing: BaxterVisionProvider = {
      key: "fail",
      name: "Fail",
      model: "fail",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        throw new Error("vision unavailable");
      },
    };
    setBaxterVisionProviderForTests(failing);

    const uploaded = await uploadReceiptPhoto({
      userId: "user-1",
      buffer: minimalJpeg(),
      filename: "receipt.jpg",
    });
    const downloaded = await downloadReceiptPhoto(uploaded.storagePath);
    expect(downloaded?.buffer.byteLength).toBeGreaterThan(0);

    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(result.ok).toBe(false);
    // Photo remains available for manual entry
    expect(await downloadReceiptPhoto(uploaded.storagePath)).not.toBeNull();
  });

  it("returns TOTAL (not subtotal) for distinct subtotal/tax/total fixture", async () => {
    const provider: BaxterVisionProvider = {
      key: "fixture",
      name: "Fixture",
      model: "fixture",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        // Simulated vision: total $47.83, subtotal was $43.99
        return {
          content: JSON.stringify(
            extractionFixture({
              amountCents: 4783,
              vendor: "Ace Hardware",
              purchasedOn: "2026-01-08",
              items: "Paint supplies",
              confidence: {
                amount: 0.93,
                vendor: 0.96,
                purchasedOn: 0.9,
                items: 0.8,
                description: 0,
              },
              warnings: [],
            }),
          ),
        };
      },
    };
    setBaxterVisionProviderForTests(provider);
    const uploaded = await uploadReceiptPhoto({
      userId: "user-1",
      buffer: minimalJpeg(),
    });
    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extraction.amountCents).toBe(4783);
      expect(result.extraction.amountCents).not.toBe(4399);
    }
  });

  it("restaurant tip: returns printed total with lower confidence", async () => {
    setBaxterVisionProviderForTests({
      key: "tip",
      name: "Tip",
      model: "tip",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        return {
          content: JSON.stringify(
            extractionFixture({
              amountCents: 6420,
              vendor: "Joe's Diner",
              confidence: {
                amount: 0.55,
                vendor: 0.9,
                purchasedOn: 0.85,
                items: 0.4,
                description: 0,
              },
              warnings: ["Handwritten tip present; returned printed total"],
            }),
          ),
        };
      },
    });
    const uploaded = await uploadReceiptPhoto({ userId: "u", buffer: minimalJpeg() });
    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(result.ok && result.extraction.amountCents).toBe(6420);
    if (result.ok) {
      expect(isLowConfidence(result.extraction.confidence.amount)).toBe(true);
    }
  });

  it("ambiguous date returns null rather than a guess", async () => {
    setBaxterVisionProviderForTests({
      key: "date",
      name: "Date",
      model: "date",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        return {
          content: JSON.stringify(
            extractionFixture({
              purchasedOn: null,
              confidence: {
                amount: 0.9,
                vendor: 0.9,
                purchasedOn: 0.15,
                items: 0,
                description: 0,
              },
              warnings: ["Date partially illegible"],
            }),
          ),
        };
      },
    });
    const uploaded = await uploadReceiptPhoto({ userId: "u", buffer: minimalJpeg() });
    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(result.ok && result.extraction.purchasedOn).toBeNull();
  });

  it("poor-quality photo returns nulls / low confidence — no fabrication", async () => {
    setBaxterVisionProviderForTests({
      key: "blur",
      name: "Blur",
      model: "blur",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        return {
          content: JSON.stringify(
            extractionFixture({
              amountCents: null,
              vendor: null,
              purchasedOn: null,
              items: null,
              description: null,
              confidence: {
                amount: 0.05,
                vendor: 0.05,
                purchasedOn: 0.05,
                items: 0,
                description: 0,
              },
              warnings: ["Image too blurry to read"],
            }),
          ),
        };
      },
    });
    const uploaded = await uploadReceiptPhoto({ userId: "u", buffer: minimalJpeg() });
    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usable).toBe(false);
      expect(result.extraction.amountCents).toBeNull();
      expect(result.extraction.vendor).toBeNull();
    }
  });

  it("self-corrects once when first JSON fails schema", async () => {
    let calls = 0;
    setBaxterVisionProviderForTests({
      key: "retry",
      name: "Retry",
      model: "retry",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        calls += 1;
        if (calls === 1) return { content: '{"amountCents":"not-a-number"}' };
        return { content: JSON.stringify(extractionFixture({ amountCents: 1999 })) };
      },
    });
    const uploaded = await uploadReceiptPhoto({ userId: "u", buffer: minimalJpeg() });
    const result = await extractReceiptFromStoragePath({ storagePath: uploaded.storagePath });
    expect(calls).toBe(2);
    expect(result.ok && result.extraction.amountCents).toBe(1999);
    if (result.ok) expect(result.correctionAttempted).toBe(true);
  });
});

describe("duplicate warning", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
  });

  it("finds matching vendor+amount within window and does not block create", async () => {
    const job = await createCustomExpenseJob({
      label: "Field supplies",
      createdBy: "user-1",
    });
    await createReceipt({
      jobId: job.id,
      amountCents: 2500,
      vendor: "Home Depot",
      purchasedOn: "2026-03-10",
      submittedBy: "user-1",
    });

    const dup = await findRecentDuplicateReceipt({
      userId: "user-1",
      vendor: "home depot",
      amountCents: 2500,
    });
    expect(dup).not.toBeNull();
    expect(dup?.amountCents).toBe(2500);

    // Still allowed to create another (warn-don't-block)
    const second = await createReceipt({
      jobId: job.id,
      amountCents: 2500,
      vendor: "Home Depot",
      purchasedOn: "2026-03-11",
      submittedBy: "user-1",
    });
    expect(second.id).toBeTruthy();
  });
});

describe("PWA manifest scoped to /receipts", () => {
  it("route module declares standalone start_url /receipts", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/receipts/manifest.webmanifest/route.ts"),
      "utf8",
    );
    expect(source).toContain('start_url: "/receipts"');
    expect(source).toContain('scope: "/receipts"');
    expect(source).toContain('display: "standalone"');
    expect(source).toContain("/icons/receipts-192.png");
    expect(source).toContain("/icons/receipts-512.png");
  });

  it("receipts layout links scoped manifest and Apple tags", () => {
    const source = readFileSync(join(process.cwd(), "src/app/receipts/layout.tsx"), "utf8");
    expect(source).toContain('manifest: "/receipts/manifest.webmanifest"');
    expect(source).toContain("appleWebApp");
    expect(source).toContain("receipts-apple-touch.png");
  });

  it("does not add a site-wide root manifest that would hijack desktop installs", () => {
    expect(() => readFileSync(join(process.cwd(), "src/app/manifest.ts"), "utf8")).toThrow();
  });
});
