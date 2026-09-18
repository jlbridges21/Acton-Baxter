import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env.public";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/** Singleton browser client — recreating per call races auth/session reads (TUS JWT). */
export function createClient() {
  if (browserClient) return browserClient;
  const env = getPublicEnv();
  browserClient = createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return browserClient;
}

export function resetSupabaseBrowserClientForTests() {
  browserClient = null;
}
