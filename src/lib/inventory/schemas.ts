import { z } from "zod";

const optionalText = z.string().trim().max(2000).optional().nullable();
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .optional()
  .nullable();

export const inventoryItemWriteSchema = z
  .object({
    itemName: z.string().trim().min(1, "Item name is required").max(300),
    sku: z.string().trim().min(1, "SKU is required").max(120),
    quantity: z.number().int().min(1, "Quantity must be at least 1").max(1_000_000),
    unitCost: z.union([z.string(), z.number()]),
    statusId: z.string().uuid().optional(),
    jobId: z.string().uuid().nullable().optional(),
    customProjectLabel: z.string().trim().max(300).nullable().optional(),
    vendor: optionalText,
    orderNumber: optionalText,
    category: optionalText,
    description: optionalText,
    productUrl: optionalText,
    photoUrl: optionalText,
    storageStateId: z.string().uuid().nullable().optional(),
    deliveryDate: optionalDate,
    outDate: optionalDate,
    notes: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const inventoryBulkSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, "Select at least one item"),
    patch: z
      .object({
        statusId: z.string().uuid().optional(),
        storageStateId: z.string().uuid().nullable().optional(),
        deliveryDate: optionalDate,
        outDate: optionalDate,
      })
      .strict(),
  })
  .strict();

export const inventoryVocabWriteSchema = z
  .object({
    kind: z.enum(["status", "storage"]),
    label: z.string().trim().min(1, "Label is required").max(120),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const inventoryVocabUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    direction: z.enum(["up", "down"]).optional(),
  })
  .strict();

export const inventoryVocabDeleteSchema = z
  .object({
    reassignToId: z.string().uuid().optional(),
  })
  .strict();
