import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Service-role client for server-side research writes.
 * Never import this module into client components.
 */
export function createServiceClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
