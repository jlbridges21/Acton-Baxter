import { z } from "zod";

export const selectedAddressSchema = z.object({
  placeId: z.string().nullable(),
  formattedAddress: z.string().min(5).max(400),
  addressLine1: z.string().min(3).max(200),
  city: z.string().min(2).max(100),
  state: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "CA" || value === "CALIFORNIA", {
      message: "Only California addresses are supported",
    })
    .transform((value) => (value === "CALIFORNIA" ? "CA" : value)),
  zipCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code"),
  county: z.string().nullable(),
  country: z.string().default("US"),
  latitude: z.number().min(32).max(42),
  longitude: z.number().min(-125).max(-114),
});

export const addressSuggestionSchema = z.object({
  placeId: z.string(),
  description: z.string(),
  mainText: z.string(),
  secondaryText: z.string(),
});

export const createReportRequestSchema = z.object({
  address: z.union([
    z
      .string()
      .trim()
      .min(5)
      .max(300)
      .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
        message: "Enter a full street address with a number and street name",
      }),
    selectedAddressSchema,
  ]),
  parentReportId: z.string().uuid().optional(),
  refreshReason: z.string().max(300).optional(),
});

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
export type SelectedAddressInput = z.infer<typeof selectedAddressSchema>;
