import { z } from "zod";

/** Manual / shared receipt form body (photo fields optional for next prompt). */
export const receiptSubmitSchema = z.object({
  jobId: z.string().uuid("Select a job"),
  /** Raw typed amount — parsed to cents server-side. */
  amount: z.string().min(1, "Amount is required"),
  vendor: z.string().trim().min(1, "Vendor is required").max(200),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date purchased is required (YYYY-MM-DD)"),
  items: z.string().trim().max(2000).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  /** Reserved for photo path after upload (next prompt). */
  photoStoragePath: z.string().trim().max(500).optional().nullable(),
  /** Reserved for OCR metadata (next prompt). */
  extraction: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type ReceiptSubmitInput = z.infer<typeof receiptSubmitSchema>;

export const expenseJobCreateSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(300),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const expenseJobUpdateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(300).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const expenseJobReorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
