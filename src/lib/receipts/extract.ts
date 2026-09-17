/**
 * Receipt field extraction via Baxter vision — schema validate + correction +
 * post-validation + orientation retry when confidence/validation fails.
 */

import "server-only";

import { getBaxterVisionProvider } from "@/lib/baxter-ai/vision";
import { formatCentsAsUsd } from "./amount";
import {
  RECEIPT_EXTRACTION_CORRECTION_PROMPT,
  buildReceiptExtractionPrompt,
  extractionHasUsableFields,
  receiptExtractionSchema,
  type ReceiptExtraction,
} from "./extraction-schema";
import {
  normalizePrintedReceiptDate,
  scoreReceiptExtraction,
  shouldRetryReceiptExtractionOrientation,
  validateReceiptExtraction,
} from "./extraction-validate";
import { rotateReceiptImageBuffer, type ReceiptRotationDegrees } from "./rotate-image";
import { downloadReceiptPhoto, sniffVisionSafeImageMime } from "./storage";

export type ReceiptExtractResult =
  | {
      ok: true;
      usable: boolean;
      extraction: ReceiptExtraction;
      correctionAttempted: boolean;
      /** Degrees applied to the winning orientation pass. */
      rotationDegrees: ReceiptRotationDegrees;
      orientationRetries: number;
    }
  | {
      ok: false;
      error: string;
      extraction: null;
    };

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error("Model returned non-JSON");
  }
}

function normalizeRawExtraction(raw: unknown, now: Date): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  // Tolerate amount as dollar string / float — coerce toward integer cents.
  if (typeof o.amountCents === "string") {
    const cleaned = o.amountCents.replace(/[^0-9.]/g, "");
    if (cleaned.includes(".")) {
      const dollars = Number.parseFloat(cleaned);
      o.amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
    } else if (cleaned) {
      const asInt = Number.parseInt(cleaned, 10);
      o.amountCents = Number.isFinite(asInt) ? asInt : null;
    } else {
      o.amountCents = null;
    }
  } else if (typeof o.amountCents === "number" && !Number.isInteger(o.amountCents)) {
    o.amountCents = Math.round(o.amountCents * 100);
  }

  if (typeof o.vendor === "string" && !o.vendor.trim()) o.vendor = null;
  if (typeof o.items === "string" && !o.items.trim()) o.items = null;
  if (typeof o.description === "string" && !o.description.trim()) o.description = null;

  if (typeof o.purchasedOn === "string") {
    const rawDate = o.purchasedOn.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      o.purchasedOn = rawDate;
    } else {
      o.purchasedOn = normalizePrintedReceiptDate(rawDate, now);
    }
  }

  if (!Array.isArray(o.lineItemAmountsCents)) o.lineItemAmountsCents = [];
  if (!Array.isArray(o.crossCheckAmountsCents)) o.crossCheckAmountsCents = [];
  if (!Array.isArray(o.warnings)) o.warnings = [];
  if (!o.confidence || typeof o.confidence !== "object") {
    o.confidence = {
      amount: 0,
      vendor: 0,
      purchasedOn: 0,
      items: 0,
      description: 0,
    };
  }
  return o;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

async function runVisionPass(input: {
  mimeType: string;
  base64Data: string;
  filename: string;
  now: Date;
  orientationHint?: string;
}): Promise<{ extraction: ReceiptExtraction; correctionAttempted: boolean } | { error: string }> {
  const provider = getBaxterVisionProvider();
  const prompt = buildReceiptExtractionPrompt({
    now: input.now,
    orientationHint: input.orientationHint,
  });

  const first = await provider.analyzeImageJson({
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    filename: input.filename,
    prompt,
  });

  let parsed = receiptExtractionSchema.safeParse(
    normalizeRawExtraction(parseJsonObject(first.content), input.now),
  );
  let correctionAttempted = false;

  if (!parsed.success) {
    correctionAttempted = true;
    const correction = await provider.analyzeImageJson({
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      filename: input.filename,
      prompt: `${RECEIPT_EXTRACTION_CORRECTION_PROMPT}${formatIssues(parsed.error.issues)}

Invalid JSON to correct (preserve meaning, do not invent):
${first.content.slice(0, 8_000)}

${prompt}`,
    });
    parsed = receiptExtractionSchema.safeParse(
      normalizeRawExtraction(parseJsonObject(correction.content), input.now),
    );
    if (!parsed.success) {
      return { error: "Could not read structured fields from this receipt photo." };
    }
  }

  return {
    extraction: validateReceiptExtraction(parsed.data, { now: input.now }),
    correctionAttempted,
  };
}

/**
 * Download stored photo → vision JSON → Zod validate → validation → orientation retries.
 */
export async function extractReceiptFromStoragePath(input: {
  storagePath: string;
  filename?: string;
  /** Optional forced rotation before the first pass (user rotate + re-extract). */
  rotationDegrees?: ReceiptRotationDegrees;
  now?: Date;
  /** Disable orientation retries (unit tests). */
  skipOrientationRetry?: boolean;
}): Promise<ReceiptExtractResult> {
  const downloaded = await downloadReceiptPhoto(input.storagePath);
  if (!downloaded) {
    return { ok: false, error: "Receipt photo not found in storage.", extraction: null };
  }

  let mimeType: string;
  try {
    mimeType = sniffVisionSafeImageMime(downloaded.buffer);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unsupported photo format",
      extraction: null,
    };
  }

  const now = input.now ?? new Date();
  const filename = input.filename ?? "receipt.jpg";
  const forced = input.rotationDegrees ?? 0;

  try {
    const initialBuffer =
      forced === 0 ? downloaded.buffer : await rotateReceiptImageBuffer(downloaded.buffer, forced);
    const initialMime = forced === 0 ? mimeType : "image/jpeg";
    const initialBase64 = initialBuffer.toString("base64");

    const firstPass = await runVisionPass({
      mimeType: initialMime,
      base64Data: initialBase64,
      filename,
      now,
    });
    if ("error" in firstPass) {
      return { ok: false, error: firstPass.error, extraction: null };
    }

    let best = {
      extraction: firstPass.extraction,
      correctionAttempted: firstPass.correctionAttempted,
      rotationDegrees: forced as ReceiptRotationDegrees,
    };
    let orientationRetries = 0;

    const shouldRetry =
      !input.skipOrientationRetry && shouldRetryReceiptExtractionOrientation(best.extraction);

    if (shouldRetry) {
      const candidates: ReceiptRotationDegrees[] = [90, 180, 270].filter(
        (d) => d !== forced,
      ) as ReceiptRotationDegrees[];

      for (const degrees of candidates) {
        orientationRetries += 1;
        const rotated = await rotateReceiptImageBuffer(downloaded.buffer, degrees);
        const pass = await runVisionPass({
          mimeType: "image/jpeg",
          base64Data: rotated.toString("base64"),
          filename,
          now,
          orientationHint: `ORIENTATION OVERRIDE: This image has been rotated ${degrees}° clockwise from the original upload so printed text should read upright. Extract fields from the upright text.`,
        });
        if ("error" in pass) continue;
        if (scoreReceiptExtraction(pass.extraction) > scoreReceiptExtraction(best.extraction)) {
          best = {
            extraction: pass.extraction,
            correctionAttempted: best.correctionAttempted || pass.correctionAttempted,
            rotationDegrees: degrees,
          };
        }
      }
    }

    return {
      ok: true,
      usable: extractionHasUsableFields(best.extraction),
      extraction: best.extraction,
      correctionAttempted: best.correctionAttempted,
      rotationDegrees: best.rotationDegrees,
      orientationRetries,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Receipt extraction failed",
      extraction: null,
    };
  }
}

/** Map extraction into form string fields (amount as dollars display). */
export function extractionToFormPrefill(extraction: ReceiptExtraction): {
  amount: string;
  vendor: string;
  purchasedOn: string;
  items: string;
  description: string;
} {
  return {
    amount:
      extraction.amountCents != null
        ? formatCentsAsUsd(extraction.amountCents).replace(/^\$/, "")
        : "",
    vendor: extraction.vendor ?? "",
    purchasedOn: extraction.purchasedOn ?? "",
    items: extraction.items ?? "",
    description: extraction.description ?? "",
  };
}
