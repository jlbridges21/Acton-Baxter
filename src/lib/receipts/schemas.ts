import { z } from "zod";

/** Manual / shared receipt form body. Exactly one of jobId / customJobLabel. */
export const receiptSubmitSchema = z
  .object({
    jobId: z.string().uuid("Select a job").optional().nullable(),
    /** One-off job text for this receipt only — not added to expense_jobs. */
    customJobLabel: z.string().trim().min(1).max(300).optional().nullable(),
    /** Raw typed amount — parsed to cents server-side. */
    amount: z.string().min(1, "Amount is required"),
    vendor: z.string().trim().min(1, "Vendor is required").max(200),
    purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date purchased is required (YYYY-MM-DD)"),
    items: z.string().trim().max(2000).optional().nullable(),
    description: z.string().trim().max(4000).optional().nullable(),
    photoStoragePath: z.string().trim().max(500).optional().nullable(),
    extraction: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const jobId = val.jobId?.trim() || null;
    const custom = val.customJobLabel?.trim() || null;
    if (jobId && custom) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a job or enter a custom label — not both",
        path: ["jobId"],
      });
    }
    if (!jobId && !custom) {
      ctx.addIssue({
        code: "custom",
        message: "Select a job or create a custom label",
        path: ["jobId"],
      });
    }
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
