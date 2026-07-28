import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { getReportStore } from "@/lib/research/report-store";

export type SalespersonOption = {
  id: string;
  displayName: string;
  email?: string | null;
  role?: string | null;
};

function shouldUseMemoryProfiles(): boolean {
  const env = getEnv();
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

/** Active Baxter users eligible as salesperson selectors (no hardcoded people). */
export async function listSalespeople(): Promise<SalespersonOption[]> {
  if (shouldUseMemoryProfiles()) {
    const profiles = await getReportStore().listProfiles();
    return profiles
      .map((p) => ({
        id: p.id,
        displayName: p.full_name?.trim() || "Unnamed user",
        role: p.role,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    displayName: (row.full_name as string | null)?.trim() || "Unnamed user",
    email: null,
    role: (row.role as string | null) ?? null,
  }));
}

export async function resolveSalespersonDisplayName(
  userId: string,
): Promise<SalespersonOption | null> {
  const all = await listSalespeople();
  return all.find((p) => p.id === userId) ?? null;
}
