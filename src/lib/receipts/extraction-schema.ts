/**
 * Receipt extraction prompt + Zod schema.
 *
 * Prompt rules for dates, totals, per-unit prices, and arithmetic self-checks
 * are load-bearing — keep wording explicit when editing.
 */

import { z } from "zod";

const confidenceField = z.number().min(0).max(1);

export const receiptExtractionSchema = z.object({
  /** Final charged / payable total in integer cents. Null if not legible. */
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
  /**
   * Individual line-item prices in cents when legible (excludes tax/tip/total lines).
   * Used for arithmetic self-check against amountCents.
   */
  lineItemAmountsCents: z.array(z.number().int().nonnegative()).default([]),
  /**
   * Other printed totals that should match amountCents (e.g. TOTAL BALANCE and
   * PLEASE PAY THIS AMOUNT both showing 1507.00).
   */
  crossCheckAmountsCents: z.array(z.number().int().positive()).default([]),
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
    "lineItemAmountsCents",
    "crossCheckAmountsCents",
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
    lineItemAmountsCents: {
      type: "array",
      items: { type: "integer", minimum: 0 },
    },
    crossCheckAmountsCents: {
      type: "array",
      items: { type: "integer", minimum: 1 },
    },
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

export function formatReceiptPromptToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Exact extraction instructions. Build fresh each call so today's date is injected.
 */
export function buildReceiptExtractionPrompt(options?: {
  now?: Date;
  orientationHint?: string;
}): string {
  const now = options?.now ?? new Date();
  const today = formatReceiptPromptToday(now);
  const currentYear = now.getFullYear();
  const orientationBlock =
    options?.orientationHint?.trim() ||
    `ORIENTATION:
- The receipt paper may appear rotated 90°, 180°, or 270° within the photo (lying sideways on a table). EXIF is already corrected — this is in-frame paper rotation.
- Read the text in whatever orientation the printed lines run. Do not skip extraction because the image looks sideways.`;

  return `You are extracting fields from a photo of a receipt, invoice, or billing statement for an employee expense log.

Today's date for reference is ${today} (current calendar year ${currentYear}). Use this only to interpret ambiguous 2-digit years and to judge whether a date looks suspicious — never to invent or "correct" a printed year.

Return ONLY valid JSON matching this shape:
{
  "amountCents": integer|null,
  "vendor": string|null,
  "purchasedOn": "YYYY-MM-DD"|null,
  "items": string|null,
  "description": string|null,
  "lineItemAmountsCents": integer[],
  "crossCheckAmountsCents": integer[],
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

${orientationBlock}

AMOUNT (amountCents) — critical:
- Amount must be the final total actually charged or the total payable on the document — not the subtotal, not the tax line alone, not the pre-tip amount, not a partial-payment line, and not a running account balance when a clearer total payable exists.
- Receipts commonly show subtotal, tax, tip, and total; grabbing the subtotal is a common receipt-OCR error. Prefer lines labeled TOTAL, TOTAL SALE, TOTAL PURCHASE, AMOUNT CHARGED, GRAND TOTAL, AMOUNT DUE, BALANCE DUE, or PLEASE PAY THIS AMOUNT over SUBTOTAL / TAX / TIP.
- PER-UNIT PRICE IS NEVER THE AMOUNT: fuel, lumber, and materials receipts show prices per gallon, per foot, per item, or per hour (e.g. "$3.969/gal"). Those unit prices are not the expense total. Find the final total (e.g. "Total Sale $63.10"), not a per-unit rate.
- Invoices and statements are valid expense documents. For them, take the total payable (PLEASE PAY THIS AMOUNT / Amount Due / Balance Due for this bill). Do not grab an older running balance or a partial-payment line when a clear total payable is printed.
- When a handwritten tip makes the printed total ambiguous, return the printed total and mark amount confidence lower (≤0.6).
- Return the amount in integer cents ($1,234.56 → 123456). Strip currency symbols, thousands separators, and OCR noise around decimal points.
- If no charged/payable total is legible, return null with low confidence. Never invent.

ARITHMETIC SELF-CHECK (required when line items are legible):
- Populate lineItemAmountsCents with each legible item price in cents (exclude tax, tip, and total lines).
- Mentally sum those line items and compare to amountCents. Example: 10.98 + 4.99 + 4.99 = 20.96. If your total disagrees with that sum, re-examine the total digits before returning.
- If the same amount appears in more than one place (e.g. TOTAL BALANCE and PLEASE PAY THIS AMOUNT both show 1507.00), populate crossCheckAmountsCents with those values. They must agree with amountCents.
- A lower-confidence value the user then verifies is far better than a confident wrong number they don't notice. If arithmetic still does not reconcile after re-examination, return your best total with amount confidence ≤0.45 and add a warning.

VENDOR:
- The business name, typically the most prominent text at the top.
- Prefer the business name over a store number, address line, or franchise location code.
- If not legible, null.

DATE (purchasedOn):
- Transcribe the printed year literally and exactly as shown. Never adjust a year for "plausibility," training-data habits, or because it seems far in the future relative to your knowledge cutoff. A receipt dated ${currentYear} or ${currentYear + 1} is normal when today's date is ${today}.
- Normalize to ISO YYYY-MM-DD.
- US receipts are MM/DD/YYYY (or MM-DD-YYYY). Treat ambiguous day/month forms accordingly and lower confidence rather than guessing silently.
- Two-digit years (e.g. 09/11/25): expand relative to today's date ${today}. Prefer the century that yields a date near today (09/11/25 → 2025-09-11 when today is ${today}), not a past-century default like 1925 or an arbitrary training-era year.
- Never invent a date — if none is legible, return null and let the user enter it.

ITEMS / DESCRIPTION (optional):
- Brief line-item summary and any useful note. Null if not useful or not legible.

NEVER FABRICATE:
- Any field not legibly present returns null with low confidence (≤0.3).
- A blank field the user fills in beats a confident wrong value they don't notice.

confidence: 0–1 per field reflecting how sure you are that the returned value is correct (0 when null).`;
}

/** @deprecated Prefer buildReceiptExtractionPrompt() so today's date is injected. */
export const RECEIPT_EXTRACTION_PROMPT = buildReceiptExtractionPrompt({
  now: new Date("2026-09-17T12:00:00.000Z"),
});

export const RECEIPT_EXTRACTION_CORRECTION_PROMPT = `Your previous JSON failed schema validation. Return corrected JSON only — same rules, same fields. Do not invent values. Fix types and nullability only.

Validation issues:
`;

/** Low-confidence threshold for UI attention flags. */
export const RECEIPT_LOW_CONFIDENCE = 0.55;

/** Purchase dates older than this many days before today are suspicious for a newly logged receipt. */
export const RECEIPT_DATE_MAX_PAST_DAYS = 730;

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
