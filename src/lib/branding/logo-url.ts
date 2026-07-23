import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { BRANDING_ASSETS_BUCKET } from "./types";

export async function getSignedLogoUrl(
  logoStoragePath: string | null,
  expiresInSeconds = 60 * 60,
): Promise<string | null> {
  if (!logoStoragePath) return null;

  const env = getEnv();
  const useMemory =
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-");

  if (useMemory) {
    // Memory mode has no storage objects; callers should fall back to ActonLogo.
    return null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BRANDING_ASSETS_BUCKET)
    .createSignedUrl(logoStoragePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}
