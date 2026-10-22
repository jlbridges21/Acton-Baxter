import "server-only";

import { getReportStore } from "@/lib/research/report-store";
import type { Profile } from "@/lib/research/db-types";

/** Profile lookup that never throws (returns null on any failure). */
export async function loadProfileSafe(userId: string): Promise<Profile | null> {
  try {
    return await getReportStore().getProfile(userId);
  } catch {
    return null;
  }
}
