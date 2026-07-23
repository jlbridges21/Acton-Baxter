export type BrandingSettings = {
  id: string;
  companyName: string;
  reportTitle: string;
  logoStoragePath: string | null;
  logoAltText: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandingUpdateInput = {
  companyName?: string;
  reportTitle?: string;
  logoAltText?: string;
  logoStoragePath?: string | null;
  updatedBy: string;
};

export type BrandingWithLogo = BrandingSettings & {
  logoUrl: string | null;
};

export const DEFAULT_COMPANY_NAME = "Acton ADU";
export const DEFAULT_REPORT_TITLE = "Acton Property Research";
export const DEFAULT_LOGO_ALT_TEXT = "Acton ADU logo";
export const BRANDING_ASSETS_BUCKET = "branding-assets";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];
