import "server-only";

import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { readViewerTour } from "@/lib/tours/map-tour";
import type { ViewerTour } from "@/lib/tours/viewer-model";

function anonClient() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** No cookies. Anonymous RLS is enough, and the page can use a revalidate window. */
export const getPublicTourBySlug = cache(async (slug: string): Promise<ViewerTour | null> => {
  const supabase = anonClient();
  return readViewerTour(async (select) => {
    const { data, error } = await supabase
      .from("tours")
      .select(select)
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();
    return { data, error };
  });
});
