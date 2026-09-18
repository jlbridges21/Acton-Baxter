import { z } from "zod";
import { INSPECTION_SUB_QUESTION_TYPES } from "./types";

export const createSiteInspectionSchema = z.object({
  projectName: z.string().trim().min(1, "Project name is required").max(300),
  address: z.string().trim().min(1, "Address is required").max(500),
  jobId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const upsertResponseSchema = z.object({
  snapshotItemId: z.string().uuid(),
  isComplete: z.boolean().optional(),
  notes: z.string().max(10000).optional(),
  answers: z
    .record(
      z.string().uuid(),
      z.object({
        type: z.enum(INSPECTION_SUB_QUESTION_TYPES),
        value: z.union([z.string(), z.array(z.string()), z.null()]),
      }),
    )
    .optional(),
});

export const setInspectionStatusSchema = z.object({
  status: z.enum(["pending", "complete"]),
});

export const itemSignedUrlsSchema = z.object({
  snapshotItemId: z.string().uuid(),
});

export const prepareMediaSchema = z.object({
  snapshotItemId: z.string().uuid(),
  clientMediaId: z.string().uuid(),
  mediaType: z.enum(["photo", "video"]),
  mimeType: z.string().trim().min(1).max(120),
  byteSize: z
    .number()
    .int()
    .nonnegative()
    .max(200 * 1024 * 1024),
});

export const completeMediaSchema = z.object({
  clientMediaId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(500).optional(),
  byteSize: z
    .number()
    .int()
    .nonnegative()
    .max(200 * 1024 * 1024)
    .optional(),
});

export const mediaStatusSchema = z.object({
  clientMediaId: z.string().uuid(),
  uploadStatus: z.enum(["pending", "uploading", "ready", "failed"]),
  uploadProgress: z.number().min(0).max(1).nullable().optional(),
});

export const deleteMediaSchema = z.object({
  mediaId: z.string().uuid(),
});
