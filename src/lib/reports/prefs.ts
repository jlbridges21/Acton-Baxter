/** Per-user Reports UI preferences (stored in Supabase, so they follow the user across devices). */

import "server-only";

import { z } from "zod";
import { agentDb, eq, selectOne } from "@/lib/agents/store";

export const reportPrefsSchema = z.object({
  suggestionsCollapsed: z.boolean().default(false),
  templatesCollapsed: z.boolean().default(false),
});
export type ReportPrefs = z.infer<typeof reportPrefsSchema>;

export async function getReportPrefs(userId: string | null): Promise<ReportPrefs> {
  if (!userId) return reportPrefsSchema.parse({});
  const row = await selectOne<{ prefs: unknown }>("bi_report_user_prefs", {
    filters: [eq("user_id", userId)],
  });
  const parsed = reportPrefsSchema.safeParse(row?.prefs ?? {});
  return parsed.success ? parsed.data : reportPrefsSchema.parse({});
}

export async function setReportPrefs(
  userId: string,
  patch: Partial<ReportPrefs>,
): Promise<ReportPrefs> {
  // Only keys actually sent change ("partial()" would still fill in defaults for the others).
  const changes = Object.fromEntries(
    Object.entries(patch).filter(
      ([k, v]) => k in reportPrefsSchema.shape && typeof v === "boolean",
    ),
  );
  const next = reportPrefsSchema.parse({ ...(await getReportPrefs(userId)), ...changes });
  const existing = await selectOne("bi_report_user_prefs", { filters: [eq("user_id", userId)] });
  if (existing)
    await agentDb().update("bi_report_user_prefs", [eq("user_id", userId)], {
      prefs: next,
      updated_at: new Date().toISOString(),
    });
  else await agentDb().insert("bi_report_user_prefs", { user_id: userId, prefs: next });
  return next;
}
