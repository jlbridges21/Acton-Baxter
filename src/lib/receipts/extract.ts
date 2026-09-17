/**
 * Receipt field extraction via Baxter vision — schema validate + one self-correction retry.
 */

import "server-only";

import { getBaxterVisionProvider } from "@/lib/baxter-ai/vision";
import { formatCentsAsUsd } from "./amount";
import {
  RECEIPT_EXTRACTION_CORRECTION_PROMPT,
  RECEIPT_EXTRACTION_PROMPT,
  extractionHasUsableFields,
  receiptExtractionSchema,
  type ReceiptExtraction,
} from "./extraction-schema";
import { downloadReceiptPhoto, sniffVisionSafeImageMime } from "./storage";

export type ReceiptExtractResult =
  | {
      ok: true;
      usable: boolean;
      extraction: ReceiptExtraction;
      correctionAttempted: boolean;
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

function normalizeRawExtraction(raw: unknown): unknown {
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
    // Model returned dollars as a float (e.g. 42.5) — convert to cents.
    o.amountCents = Math.round(o.amountCents * 100);
  }

  if (typeof o.vendor === "string" && !o.vendor.trim()) o.vendor = null;
  if (typeof o.items === "string" && !o.items.trim()) o.items = null;
  if (typeof o.description === "string" && !o.description.trim()) o.description = null;
  if (typeof o.purchasedOn === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(o.purchasedOn)) {
    o.purchasedOn = null;
  }
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

/**
 * Download stored photo → vision JSON → Zod validate → one correction retry.
 */
export async function extractReceiptFromStoragePath(input: {
  storagePath: string;
  filename?: string;
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

  const provider = getBaxterVisionProvider();
  const base64Data = downloaded.buffer.toString("base64");
  const filename = input.filename ?? "receipt.jpg";

  try {
    const first = await provider.analyzeImageJson({
      mimeType,
      base64Data,
      filename,
      prompt: RECEIPT_EXTRACTION_PROMPT,
    });

    let parsed = receiptExtractionSchema.safeParse(
      normalizeRawExtraction(parseJsonObject(first.content)),
    );
    let correctionAttempted = false;

    if (!parsed.success) {
      correctionAttempted = true;
      const correction = await provider.analyzeImageJson({
        mimeType,
        base64Data,
        filename,
        prompt: `${RECEIPT_EXTRACTION_CORRECTION_PROMPT}${formatIssues(parsed.error.issues)}

Invalid JSON to correct (preserve meaning, do not invent):
${first.content.slice(0, 8_000)}

${RECEIPT_EXTRACTION_PROMPT}`,
      });
      parsed = receiptExtractionSchema.safeParse(
        normalizeRawExtraction(parseJsonObject(correction.content)),
      );
      if (!parsed.success) {
        return {
          ok: false,
          error: "Could not read structured fields from this receipt photo.",
          extraction: null,
        };
      }
    }

    return {
      ok: true,
      usable: extractionHasUsableFields(parsed.data),
      extraction: parsed.data,
      correctionAttempted,
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
