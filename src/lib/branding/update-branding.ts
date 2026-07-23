import "server-only";

import { randomUUID } from "node:crypto";
import { ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  getBrandingSettings,
  resetMemoryBrandingForTests,
  setMemoryBrandingForTests,
  usesMemoryBrandingStore,
} from "./get-branding";
import { logoUploadMetaSchema } from "./schemas";
import {
  ALLOWED_LOGO_MIME_TYPES,
  BRANDING_ASSETS_BUCKET,
  MAX_LOGO_BYTES,
  type AllowedLogoMimeType,
  type BrandingSettings,
  type BrandingUpdateInput,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function extensionForMime(contentType: AllowedLogoMimeType): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export async function updateBrandingSettings(
  input: BrandingUpdateInput,
): Promise<BrandingSettings> {
  const current = await getBrandingSettings();
  const next: BrandingSettings = {
    ...current,
    companyName: input.companyName ?? current.companyName,
    reportTitle: input.reportTitle ?? current.reportTitle,
    logoAltText: input.logoAltText ?? current.logoAltText,
    logoStoragePath:
      input.logoStoragePath === undefined ? current.logoStoragePath : input.logoStoragePath,
    updatedBy: input.updatedBy,
    updatedAt: nowIso(),
  };

  if (usesMemoryBrandingStore()) {
    setMemoryBrandingForTests(next);
    return next;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("branding_settings")
    .upsert(
      {
        id: current.id,
        company_name: next.companyName,
        report_title: next.reportTitle,
        logo_alt_text: next.logoAltText,
        logo_storage_path: next.logoStoragePath,
        updated_by: next.updatedBy,
        updated_at: next.updatedAt,
        singleton_key: true,
      },
      { onConflict: "singleton_key" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return {
    id: data.id,
    companyName: data.company_name,
    reportTitle: data.report_title,
    logoStoragePath: data.logo_storage_path,
    logoAltText: data.logo_alt_text,
    updatedBy: data.updated_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function uploadBrandingLogo(options: {
  file: File | Blob;
  fileName: string;
  contentType: string;
  updatedBy: string;
}): Promise<BrandingSettings> {
  const contentType = options.contentType.toLowerCase();
  if (contentType === "image/svg+xml" || options.fileName.toLowerCase().endsWith(".svg")) {
    throw new ValidationError("SVG logos are not allowed. Upload PNG, JPEG, or WEBP.");
  }

  const meta = logoUploadMetaSchema.safeParse({
    contentType,
    size: options.file.size,
    fileName: options.fileName,
  });
  if (!meta.success) {
    throw new ValidationError(meta.error.issues[0]?.message ?? "Invalid logo upload");
  }
  if (!ALLOWED_LOGO_MIME_TYPES.includes(meta.data.contentType)) {
    throw new ValidationError("Only PNG, JPEG, and WEBP logos are allowed");
  }
  if (meta.data.size > MAX_LOGO_BYTES) {
    throw new ValidationError("Logo must be 2MB or smaller");
  }

  const current = await getBrandingSettings();
  const extension = extensionForMime(meta.data.contentType);
  const storagePath = `company/logo-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;

  if (usesMemoryBrandingStore()) {
    return updateBrandingSettings({
      updatedBy: options.updatedBy,
      logoStoragePath: storagePath,
    });
  }

  const supabase = createServiceClient();
  const buffer = Buffer.from(await options.file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(BRANDING_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: meta.data.contentType,
      upsert: false,
    });
  if (uploadError) {
    throw new ValidationError(uploadError.message || "Logo upload failed");
  }

  if (current.logoStoragePath && current.logoStoragePath !== storagePath) {
    await supabase.storage.from(BRANDING_ASSETS_BUCKET).remove([current.logoStoragePath]);
  }

  return updateBrandingSettings({
    updatedBy: options.updatedBy,
    logoStoragePath: storagePath,
  });
}

export async function removeBrandingLogo(updatedBy: string): Promise<BrandingSettings> {
  const current = await getBrandingSettings();
  if (current.logoStoragePath && !usesMemoryBrandingStore()) {
    const supabase = createServiceClient();
    await supabase.storage.from(BRANDING_ASSETS_BUCKET).remove([current.logoStoragePath]);
  }
  return updateBrandingSettings({
    updatedBy,
    logoStoragePath: null,
  });
}

export { resetMemoryBrandingForTests };
