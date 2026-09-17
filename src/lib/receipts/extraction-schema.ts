/**
 * Receipt OCR extraction — strict Zod schema + JSON Schema for vision output.
 */

import { z } from "zod";

const confidenceField = z.number().min(0).max(1);

export const receiptExtractionSchema = z.object({
  /** Final charged total in integer cents. Null if not legible. */
  amountCents: z.number().int().positive().nullable(),
  /** Business / vendor name. Null if not legible. */
  vendor: z.string().trim().min(1).max(200).nullable(),
  /** ISO date YYYY-MM-DD. Null if not legible — never invent. */
  purchasedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  items: z.string().trim().max(2000).nullable(),
  description: z.string().trim().max(4000).nullable(),
  confidence: z.object({
    amount: confidenceField,
    vendor: confidenceField,
    purchasedOn: confidenceField,
    items: confidenceField,
    description: confidenceField,
  }),
  warnings: z.array(z.string()).default([]),
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

/** OpenAI-style JSON Schema (strict object) matching receiptExtractionSchema. */
export const RECEIPT_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "amountCents",
    "vendor",
    "purchasedOn",
    "items",
    "description",
    "confidence",
    "warnings",
  ],
  properties: {
    amountCents: { type: ["integer", "null"], minimum: 1 },
    vendor: { type: ["string", "null"], maxLength: 200 },
    purchasedOn: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    },
    items: { type: ["string", "null"], maxLength: 2000 },
    description: { type: ["string", "null"], maxLength: 4000 },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["amount", "vendor", "purchasedOn", "items", "description"],
      properties: {
        amount: { type: "number", minimum: 0, maximum: 1 },
        vendor: { type: "number", minimum: 0, maximum: 1 },
        purchasedOn: { type: "number", minimum: 0, maximum: 1 },
        items: { type: "number", minimum: 0, maximum: 1 },
        description: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * Exact extraction instructions. The subtotal-vs-total rule is the #1 OCR failure mode —
 * keep this wording explicit and unchanged when editing.
 */
export const RECEIPT_EXTRACTION_PROMPT = `You are extracting fields from a photo of a store or restaurant receipt for an employee expense log.

Return ONLY valid JSON matching this shape:
{
  "amountCents": integer|null,
  "vendor": string|null,
  "purchasedOn": "YYYY-MM-DD"|null,
  "items": string|null,
  "description": string|null,
  "confidence": {
    "amount": 0-1,
    "vendor": 0-1,
    "purchasedOn": 0-1,
    "items": 0-1,
    "description": 0-1
  },
  "warnings": string[]
}

Rules — follow exactly:

AMOUNT (amountCents) — critical:
- Amount must be the final total actually charged — not the subtotal, not the tax line, not the pre-tip amount, not "amount due" on an unpaid invoice.
- Receipts commonly show subtotal, tax, tip, and total; grabbing the subtotal is the single most common receipt-OCR error. Prefer lines labeled TOTAL, AMOUNT CHARGED, or GRAND TOTAL over SUBTOTAL / TAX / TIP.
- When a handwritten tip makes the printed total ambiguous, return the printed total and mark amount confidence lower (≤0.6).
- Return the amount in integer cents ($1,234.56 → 123456). Strip currency symbols, thousands separators, and OCR noise around decimal points.
- If no charged total is legible, return null with low confidence. Never invent.

VENDOR:
- The business name, typically the most prominent text at the top.
- Prefer the business name over a store number, address line, or franchise location code.
- If not legible, null.

DATE (purchasedOn):
- Normalize to ISO YYYY-MM-DD.
- US receipts are MM/DD/YYYY; treat ambiguous day/month forms accordingly and lower confidence rather than guessing silently.
- Never invent a date — if none is legible, return null and let the user enter it.

ITEMS / DESCRIPTION (optional):
- Brief line-item summary and any useful note. Null if not useful or not legible.

NEVER FABRICATE:
- Any field not legibly present returns null with low confidence (≤0.3).
- A blank field the user fills in beats a confident wrong value they don't notice.

confidence: 0–1 per field reflecting how sure you are that the returned value is correct (0 when null).`;

export const RECEIPT_EXTRACTION_CORRECTION_PROMPT = `Your previous JSON failed schema validation. Return corrected JSON only — same rules, same fields. Do not invent values. Fix types and nullability only.

Validation issues:
`;

/** Low-confidence threshold for UI attention flags. */
export const RECEIPT_LOW_CONFIDENCE = 0.55;

export function isLowConfidence(value: number | null | undefined): boolean {
  if (value == null) return true;
  return value <= RECEIPT_LOW_CONFIDENCE;
}

/** True when extraction has at least one usable required field. */
export function extractionHasUsableFields(extraction: ReceiptExtraction): boolean {
  return (
    extraction.amountCents != null ||
    (extraction.vendor != null && extraction.vendor.trim().length > 0) ||
    extraction.purchasedOn != null
  );
}
