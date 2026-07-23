import { z } from "zod";
import { ALLOWED_LOGO_MIME_TYPES } from "./types";

export const brandingUpdateSchema = z.object({
  companyName: z.string().trim().min(2).max(80).optional(),
  reportTitle: z.string().trim().min(2).max(120).optional(),
  logoAltText: z.string().trim().min(2).max(120).optional(),
});

export const logoUploadMetaSchema = z.object({
  contentType: z.enum(ALLOWED_LOGO_MIME_TYPES),
  size: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(200),
});

export type BrandingUpdatePayload = z.infer<typeof brandingUpdateSchema>;
export type LogoUploadMeta = z.infer<typeof logoUploadMetaSchema>;
