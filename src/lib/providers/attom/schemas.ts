import { z } from "zod";

export const attomStatusSchema = z
  .object({
    version: z.string().optional(),
    code: z.union([z.number(), z.string()]).optional(),
    msg: z.string().optional(),
    total: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const attomResponseSchema = z
  .object({
    status: attomStatusSchema.optional(),
    property: z.array(z.record(z.string(), z.unknown())).optional(),
    response: z
      .object({
        result: z
          .object({
            property: z.array(z.record(z.string(), z.unknown())).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AttomResponse = z.infer<typeof attomResponseSchema>;
