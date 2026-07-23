import { z } from "zod";

export const arcgisSpatialReferenceSchema = z
  .object({
    wkid: z.number().optional(),
    latestWkid: z.number().optional(),
  })
  .passthrough();

export const arcgisErrorSchema = z
  .object({
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
        details: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const arcgisFeatureSchema = z
  .object({
    attributes: z.record(z.string(), z.unknown()).default({}),
    geometry: z.unknown().optional(),
  })
  .passthrough();

export const arcgisQueryResponseSchema = z
  .object({
    features: z.array(arcgisFeatureSchema).optional().default([]),
    exceededTransferLimit: z.boolean().optional(),
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
        details: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

export const arcgisLayerMetadataSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    fields: z
      .array(
        z
          .object({
            name: z.string(),
            type: z.string().optional(),
            alias: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    geometryType: z.string().optional(),
    extent: z.unknown().optional(),
  })
  .passthrough();

export type ArcgisFeature = z.infer<typeof arcgisFeatureSchema>;
export type ArcgisQueryResponse = z.infer<typeof arcgisQueryResponseSchema>;
export type ArcgisLayerMetadata = z.infer<typeof arcgisLayerMetadataSchema>;
