/**
 * Receipt extraction accuracy — ground-truth fixtures, date/amount validation,
 * arithmetic self-check, and orientation retry.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildReceiptExtractionPrompt,
  receiptExtractionSchema,
} from "@/lib/receipts/extraction-schema";
import {
  expandTwoDigitYear,
  normalizePrintedReceiptDate,
  scoreReceiptExtraction,
  shouldRetryReceiptExtractionOrientation,
  validateReceiptExtraction,
} from "@/lib/receipts/extraction-validate";
import { extractReceiptFromStoragePath } from "@/lib/receipts/extract";
import { resetReceiptPhotosMemoryForTests, uploadReceiptPhoto } from "@/lib/receipts/storage";
import { resetReceiptLogMemoryForTests } from "@/lib/receipts/store";
import {
  setBaxterVisionProviderForTests,
  type BaxterVisionProvider,
  type ImageAnalysisResult,
} from "@/lib/baxter-ai/vision";
import {
  RECEIPT_FIXTURE_GROUND_TRUTH,
  getReceiptFixtureGroundTruth,
} from "../fixtures/receipts/ground-truth";

const NOW = new Date("2026-09-17T15:00:00.000Z");

/** Minimal valid JPEG. */
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

function fixtureExtraction(
  partial: Record<string, unknown> & {
    amountCents: number | null;
    vendor: string | null;
    purchasedOn: string | null;
  },
) {
  return {
    items: null,
    description: null,
    lineItemAmountsCents: [],
    crossCheckAmountsCents: [],
    confidence: {
      amount: partial.amountCents == null ? 0.1 : 0.9,
      vendor: partial.vendor ? 0.9 : 0.1,
      purchasedOn: partial.purchasedOn ? 0.9 : 0.1,
      items: 0,
      description: 0,
    },
    warnings: [],
    ...partial,
  };
}

describe("date literal + 2-digit year handling", () => {
  it("expands 09/11/25 to 2025 relative to Sep 2026", () => {
    expect(expandTwoDigitYear(25, NOW)).toBe(2025);
    expect(normalizePrintedReceiptDate("09/11/25", NOW)).toBe("2025-09-11");
    expect(normalizePrintedReceiptDate("07-05-2026", NOW)).toBe("2026-07-05");
  });

  it("flags implausible past and future dates as low-confidence", () => {
    const past = validateReceiptExtraction(
      receiptExtractionSchema.parse(
        fixtureExtraction({
          amountCents: 2096,
          vendor: "Trader Joe's",
          purchasedOn: "2022-07-05",
          confidence: {
            amount: 0.9,
            vendor: 0.9,
            purchasedOn: 0.95,
            items: 0,
            description: 0,
          },
        }),
      ),
      { now: NOW },
    );
    expect(past.purchasedOn).toBe("2022-07-05");
    expect(past.confidence.purchasedOn).toBeLessThanOrEqual(0.35);
    expect(past.warnings.some((w) => /years before/i.test(w))).toBe(true);

    const future = validateReceiptExtraction(
      receiptExtractionSchema.parse(
        fixtureExtraction({
          amountCents: 100,
          vendor: "X",
          purchasedOn: "2027-01-01",
          confidence: {
            amount: 0.9,
            vendor: 0.9,
            purchasedOn: 0.9,
            items: 0,
            description: 0,
          },
        }),
      ),
      { now: NOW },
    );
    expect(future.confidence.purchasedOn).toBeLessThanOrEqual(0.35);
    expect(future.warnings.some((w) => /future/i.test(w))).toBe(true);
  });
});

describe("arithmetic + cross-check self-check", () => {
  it("lowers amount confidence when line items contradict the total (Trader Joe's class)", () => {
    const wrong = validateReceiptExtraction(
      receiptExtractionSchema.parse(
        fixtureExtraction({
          amountCents: 2695,
          vendor: "Trader Joe's",
          purchasedOn: "2026-07-05",
          lineItemAmountsCents: [1098, 499, 499],
          confidence: {
            amount: 0.92,
            vendor: 0.95,
            purchasedOn: 0.9,
            items: 0.8,
            description: 0,
          },
        }),
      ),
      { now: NOW },
    );
    expect(1098 + 499 + 499).toBe(2096);
    expect(wrong.amountCents).toBe(2695); // value kept — user verifies
    expect(wrong.confidence.amount).toBeLessThanOrEqual(0.4);
    expect(wrong.warnings.some((w) => /Line items sum/i.test(w))).toBe(true);
  });

  it("lowers confidence when printed totals disagree (dental class)", () => {
    const bad = validateReceiptExtraction(
      receiptExtractionSchema.parse(
        fixtureExtraction({
          amountCents: 160700,
          vendor: "Dental",
          purchasedOn: "2026-07-24",
          crossCheckAmountsCents: [150700],
          confidence: {
            amount: 0.9,
            vendor: 0.9,
            purchasedOn: 0.9,
            items: 0,
            description: 0,
          },
        }),
      ),
      { now: NOW },
    );
    expect(bad.confidence.amount).toBeLessThanOrEqual(0.4);
    expect(bad.warnings.some((w) => /disagree/i.test(w))).toBe(true);
  });
});

describe("fixture ground truth regression (mocked vision)", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    resetReceiptPhotosMemoryForTests();
    setBaxterVisionProviderForTests(null);
  });

  for (const fixture of RECEIPT_FIXTURE_GROUND_TRUTH) {
    it(`${fixture.label} extracts ground truth amount/date/vendor`, async () => {
      const gt = getReceiptFixtureGroundTruth(fixture.id);
      setBaxterVisionProviderForTests({
        key: "gt",
        name: "GroundTruth",
        model: "gt",
        async analyzeImage(): Promise<ImageAnalysisResult> {
          throw new Error("unused");
        },
        async analyzeImageJson() {
          return {
            content: JSON.stringify(
              fixtureExtraction({
                amountCents: gt.amountCents,
                vendor: gt.vendor,
                purchasedOn: gt.purchasedOn,
                lineItemAmountsCents: gt.lineItemAmountsCents ?? [],
                crossCheckAmountsCents: gt.crossCheckAmountsCents ?? [],
                items: fixture.id === "trader-joes" ? "Groceries" : null,
                confidence: {
                  amount: 0.93,
                  vendor: 0.95,
                  purchasedOn: 0.92,
                  items: 0.7,
                  description: 0,
                },
              }),
            ),
          };
        },
      });

      const uploaded = await uploadReceiptPhoto({
        userId: "user-1",
        buffer: minimalJpeg(),
        filename: `${fixture.id}.jpg`,
      });
      const result = await extractReceiptFromStoragePath({
        storagePath: uploaded.storagePath,
        now: NOW,
        skipOrientationRetry: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.extraction.amountCents).toBe(gt.amountCents);
        expect(result.extraction.purchasedOn).toBe(gt.purchasedOn);
        expect(result.extraction.vendor?.toLowerCase()).toContain(
          gt.vendor.split(" ")[0]!.toLowerCase(),
        );
        // Previously-wrong values must not reappear as confident accepts
        expect(result.extraction.amountCents).not.toBe(gt.previouslyExtracted.amountCents);
        if (result.extraction.purchasedOn === gt.previouslyExtracted.purchasedOn) {
          expect(result.extraction.confidence.purchasedOn).toBeLessThanOrEqual(0.35);
        }
      }
    });
  }

  it("flags the known wrong year extractions as low-confidence rather than accepting silently", () => {
    for (const fixture of RECEIPT_FIXTURE_GROUND_TRUTH) {
      const flagged = validateReceiptExtraction(
        receiptExtractionSchema.parse(
          fixtureExtraction({
            amountCents: fixture.amountCents,
            vendor: fixture.vendor,
            purchasedOn: fixture.previouslyExtracted.purchasedOn,
            confidence: {
              amount: 0.9,
              vendor: 0.9,
              purchasedOn: 0.95,
              items: 0,
              description: 0,
            },
          }),
        ),
        { now: NOW },
      );
      expect(flagged.confidence.purchasedOn).toBeLessThanOrEqual(0.35);
      expect(shouldRetryReceiptExtractionOrientation(flagged)).toBe(true);
    }
  });
});

describe("orientation retry picks better-scoring rotation", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    resetReceiptPhotosMemoryForTests();
    setBaxterVisionProviderForTests(null);
  });

  it("retries rotated passes when upright read is low-confidence and keeps the better result", async () => {
    const gt = getReceiptFixtureGroundTruth("costco-gas");
    let call = 0;
    const provider: BaxterVisionProvider = {
      key: "rot",
      name: "Rot",
      model: "rot",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson(input) {
        call += 1;
        const rotatedHint = input.prompt.includes("ORIENTATION OVERRIDE");
        if (!rotatedHint) {
          // Sideways misread: per-unit price + wrong year
          return {
            content: JSON.stringify(
              fixtureExtraction({
                amountCents: gt.previouslyExtracted.amountCents,
                vendor: "Costco",
                purchasedOn: gt.previouslyExtracted.purchasedOn,
                confidence: {
                  amount: 0.5,
                  vendor: 0.8,
                  purchasedOn: 0.5,
                  items: 0,
                  description: 0,
                },
                warnings: ["uncertain"],
              }),
            ),
          };
        }
        // After rotation: correct total + date
        return {
          content: JSON.stringify(
            fixtureExtraction({
              amountCents: gt.amountCents,
              vendor: gt.vendor,
              purchasedOn: gt.purchasedOn,
              confidence: {
                amount: 0.94,
                vendor: 0.96,
                purchasedOn: 0.93,
                items: 0,
                description: 0,
              },
            }),
          ),
        };
      },
    };
    setBaxterVisionProviderForTests(provider);

    const uploaded = await uploadReceiptPhoto({
      userId: "user-1",
      buffer: minimalJpeg(),
      filename: "costco-rotated.jpg",
    });
    const result = await extractReceiptFromStoragePath({
      storagePath: uploaded.storagePath,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orientationRetries).toBeGreaterThan(0);
      expect(result.extraction.amountCents).toBe(6310);
      expect(result.extraction.purchasedOn).toBe("2025-09-11");
      expect(result.rotationDegrees).toBeGreaterThan(0);
      expect(scoreReceiptExtraction(result.extraction)).toBeGreaterThan(
        scoreReceiptExtraction(
          validateReceiptExtraction(
            receiptExtractionSchema.parse(
              fixtureExtraction({
                amountCents: 318,
                vendor: "Costco",
                purchasedOn: "2023-09-11",
                confidence: {
                  amount: 0.5,
                  vendor: 0.8,
                  purchasedOn: 0.5,
                  items: 0,
                  description: 0,
                },
              }),
            ),
            { now: NOW },
          ),
        ),
      );
    }
    expect(call).toBeGreaterThan(1);
  });
});

describe("illegible input never fabricates", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetReceiptLogMemoryForTests();
    resetReceiptPhotosMemoryForTests();
    setBaxterVisionProviderForTests(null);
  });

  it("returns nulls with low confidence for blank vision output", async () => {
    setBaxterVisionProviderForTests({
      key: "blank",
      name: "Blank",
      model: "blank",
      async analyzeImage(): Promise<ImageAnalysisResult> {
        throw new Error("unused");
      },
      async analyzeImageJson() {
        return {
          content: JSON.stringify(
            fixtureExtraction({
              amountCents: null,
              vendor: null,
              purchasedOn: null,
              confidence: {
                amount: 0.05,
                vendor: 0.05,
                purchasedOn: 0.05,
                items: 0,
                description: 0,
              },
              warnings: ["Illegible"],
            }),
          ),
        };
      },
    });
    const uploaded = await uploadReceiptPhoto({
      userId: "user-1",
      buffer: minimalJpeg(),
    });
    const result = await extractReceiptFromStoragePath({
      storagePath: uploaded.storagePath,
      now: NOW,
      skipOrientationRetry: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extraction.amountCents).toBeNull();
      expect(result.extraction.vendor).toBeNull();
      expect(result.extraction.purchasedOn).toBeNull();
      expect(result.usable).toBe(false);
    }
  });
});

describe("prompt wording for failure classes", () => {
  it("includes date-literal, per-unit, and arithmetic self-check wording", () => {
    const prompt = buildReceiptExtractionPrompt({ now: NOW });
    expect(prompt).toContain(
      'Transcribe the printed year literally and exactly as shown. Never adjust a year for "plausibility,"',
    );
    expect(prompt).toContain(
      "PER-UNIT PRICE IS NEVER THE AMOUNT: fuel, lumber, and materials receipts show prices per gallon, per foot, per item, or per hour",
    );
    expect(prompt).toContain(
      "Mentally sum those line items and compare to amountCents. Example: 10.98 + 4.99 + 4.99 = 20.96.",
    );
    expect(prompt).toContain("Invoices and statements are valid expense documents");
    expect(prompt).toContain("rotated 90°, 180°, or 270°");
  });
});
