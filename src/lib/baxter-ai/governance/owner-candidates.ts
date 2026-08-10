import "server-only";

import { isAppAccessRole } from "@/lib/auth/roles";
import { getEnv } from "@/lib/env";
import { formatHumanDisplayName } from "@/lib/pem-neat/display-name";
import { getReportStore } from "@/lib/research/report-store";
import { createServiceClient } from "@/lib/supabase/admin";

export type GovernanceOwnerCandidate = {
  id: string;
  displayName: string;
  email: string | null;
  role: string | null;
};

function shouldUseMemoryProfiles(): boolean {
  try {
    const env = getEnv();
    return (
      env.E2E_TEST_AUTH_BYPASS ||
      env.ENABLE_MOCK_RESEARCH ||
      env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
    );
  } catch {
    return process.env.NODE_ENV === "test" || process.env.ENABLE_MOCK_RESEARCH === "true";
  }
}

/**
 * Active app-access profiles for governance domain-owner assignment.
 * Display name + email only — callers must never require the admin to paste a UUID.
 */
export async function listGovernanceOwnerCandidates(): Promise<GovernanceOwnerCandidate[]> {
  if (shouldUseMemoryProfiles()) {
    const profiles = await getReportStore().listProfiles();
    return profiles
      .filter((p) => isAppAccessRole(p.role))
      .map((p) => ({
        id: p.id,
        displayName: formatHumanDisplayName(p.full_name?.trim() || "Unnamed user"),
        email: null,
        role: p.role,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["user", "admin", "super_admin"])
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[governance] Failed to list owner candidates:", error.message);
    return [];
  }

  const emailById = new Map<string, string>();
  try {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (!authError) {
      for (const authUser of authData.users) {
        if (authUser.id && authUser.email) emailById.set(authUser.id, authUser.email);
      }
    }
  } catch {
    // Email enrichment is best-effort
  }

  return (data ?? []).map((row) => {
    const id = String(row.id);
    return {
      id,
      displayName: formatHumanDisplayName(
        (row.full_name as string | null)?.trim() || "Unnamed user",
      ),
      email: emailById.get(id) ?? null,
      role: (row.role as string | null) ?? null,
    };
  });
}
