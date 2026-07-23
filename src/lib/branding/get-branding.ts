import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { getSignedLogoUrl } from "./logo-url";
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_LOGO_ALT_TEXT,
  DEFAULT_REPORT_TITLE,
  type BrandingSettings,
  type BrandingWithLogo,
} from "./types";

type BrandingRow = {
  id: string;
  company_name: string;
  report_title: string;
  logo_storage_path: string | null;
  logo_alt_text: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryBrandingState = {
  settings: BrandingSettings;
};

const globalMemory = globalThis as typeof globalThis & {
  __actonBrandingMemory?: MemoryBrandingState;
};

function nowIso() {
  return new Date().toISOString();
}

function defaultBranding(): BrandingSettings {
  const timestamp = nowIso();
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    companyName: DEFAULT_COMPANY_NAME,
    reportTitle: DEFAULT_REPORT_TITLE,
    logoStoragePath: null,
    logoAltText: DEFAULT_LOGO_ALT_TEXT,
    updatedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function getMemoryState(): MemoryBrandingState {
  if (!globalMemory.__actonBrandingMemory) {
    globalMemory.__actonBrandingMemory = { settings: defaultBranding() };
  }
  return globalMemory.__actonBrandingMemory;
}

export function usesMemoryBrandingStore(env = getEnv()): boolean {
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function mapRow(row: BrandingRow): BrandingSettings {
  return {
    id: row.id,
    companyName: row.company_name,
    reportTitle: row.report_title,
    logoStoragePath: row.logo_storage_path,
    logoAltText: row.logo_alt_text,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  if (usesMemoryBrandingStore()) {
    return getMemoryState().settings;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("branding_settings")
    .select("*")
    .eq("singleton_key", true)
    .maybeSingle();

  // Migration may not be applied yet in some environments; never break page render.
  if (error) {
    console.warn("[branding] falling back to defaults:", error.message);
    return defaultBranding();
  }
  if (!data) return defaultBranding();
  return mapRow(data as BrandingRow);
}

export async function getBrandingWithLogo(): Promise<BrandingWithLogo> {
  const settings = await getBrandingSettings();
  const logoUrl = await getSignedLogoUrl(settings.logoStoragePath);
  return { ...settings, logoUrl };
}

export function getMemoryBrandingForTests(): BrandingSettings {
  return getMemoryState().settings;
}

export function setMemoryBrandingForTests(settings: BrandingSettings) {
  getMemoryState().settings = settings;
}

export function resetMemoryBrandingForTests() {
  globalMemory.__actonBrandingMemory = { settings: defaultBranding() };
}
