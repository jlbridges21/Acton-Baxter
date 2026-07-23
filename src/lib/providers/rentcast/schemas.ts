import { z } from "zod";

export const rentCastPropertySchema = z.record(z.string(), z.unknown());

export const rentCastResponseSchema = z.union([
  z.array(rentCastPropertySchema),
  z.object({
    properties: z.array(rentCastPropertySchema).optional(),
    data: z.array(rentCastPropertySchema).optional(),
  }),
]);

export type RentCastPropertyRecord = z.infer<typeof rentCastPropertySchema>;
