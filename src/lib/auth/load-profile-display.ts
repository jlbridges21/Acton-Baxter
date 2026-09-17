/**
 * Batch-load display info for profile ids: profiles.full_name + auth.users email.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { buildProfileDisplayInfo, type ProfileDisplayInfo } from "./profile-display";

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/** Best-effort auth.users email map (paginated). Matches /admin/users enrichment. */
export async function loadAuthEmailsByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(userIds.filter(Boolean));
  const map = new Map<string, string>();
  if (wanted.size === 0) return map;

  try {
    const supabase = createServiceClient();
    let page = 1;
    const perPage = 200;
    while (map.size < wanted.size && page <= 20) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = data?.users ?? [];
      if (users.length === 0) break;
      for (const authUser of users) {
        if (authUser.id && authUser.email && wanted.has(authUser.id)) {
          map.set(authUser.id, authUser.email);
        }
      }
      if (users.length < perPage) break;
      page += 1;
    }
  } catch {
    // Email enrichment is best-effort
  }
  return map;
}

/**
 * Resolve display names for a set of profile ids.
 * Queries `profiles` for full_name only (no email column — that caused the
 * Receipt Log "User db7d393c" bug), then enriches emails from auth.users.
 */
export async function loadProfileDisplayByIds(
  userIds: string[],
): Promise<Map<string, ProfileDisplayInfo>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const map = new Map<string, ProfileDisplayInfo>();
  if (unique.length === 0) return map;

  if (shouldUseMemory()) {
    try {
      const { getReportStore } = await import("@/lib/research/report-store");
      const profiles = await getReportStore().listProfiles();
      const byId = new Map(profiles.map((p) => [p.id, p]));
      for (const id of unique) {
        const profile = byId.get(id);
        map.set(
          id,
          buildProfileDisplayInfo({
            id,
            fullName: profile?.full_name ?? null,
            email: null,
          }),
        );
      }
    } catch {
      for (const id of unique) {
        map.set(id, buildProfileDisplayInfo({ id, fullName: null, email: null }));
      }
    }
    return map;
  }

  const fullNameById = new Map<string, string>();
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    if (error) throw error;
    for (const row of data ?? []) {
      fullNameById.set(String(row.id), String(row.full_name ?? "").trim());
    }
  } catch (error) {
    console.error("loadProfileDisplayByIds: profiles query failed", error);
  }

  const emailById = await loadAuthEmailsByUserIds(unique);

  for (const id of unique) {
    map.set(
      id,
      buildProfileDisplayInfo({
        id,
        fullName: fullNameById.get(id) || null,
        email: emailById.get(id) ?? null,
      }),
    );
  }
  return map;
}
