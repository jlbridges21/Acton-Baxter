/**
 * Suggested reports that are genuinely useful to this viewer right now:
 *   - feasible: every required capability is verified "ready"/"partial" in the data catalog,
 *   - not already covered by an active report the viewer can open (see suggestion-match.ts),
 *   - not dismissed by the viewer,
 *   - not one of the four gallery templates (those appear in "Start from a template").
 * States: available | in_progress | completed | dismissed | not_feasible.
 * "Completed" is derived from coverage, so archiving/deleting the only matching report makes
 * the suggestion available again. No AI calls.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import { ValidationError } from "@/lib/errors";
import type { ReportsAccess } from "./access";
import { SUGGESTED_REPORTS, suggestedReports } from "./capabilities";
import { listReportsFor, type ReportRow } from "./repo";
import { reportCoversSuggestion, specMatchesSuggestion } from "./suggestion-match";

export type SuggestionState =
  "available" | "in_progress" | "completed" | "dismissed" | "not_feasible";
type StateRow = {
  user_id: string;
  suggestion_key: string;
  status: "in_progress" | "completed" | "dismissed";
  report_id: string | null;
  updated_at: string;
};

const IN_PROGRESS_TTL_MS = 6 * 3600_000;
const FEASIBILITY_TTL_MS = 5 * 60_000;

// Feasibility depends only on the data catalog and the viewer's data categories — cache briefly.
const feasibilityCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof suggestedReports>> }
>();
export function resetSuggestionCacheForTests() {
  feasibilityCache.clear();
}
async function feasibility(access: ReportsAccess) {
  const key = [...access.categories].sort().join(",");
  const hit = feasibilityCache.get(key);
  if (hit && Date.now() - hit.at < FEASIBILITY_TTL_MS) return hit.value;
  const value = await suggestedReports(access);
  feasibilityCache.set(key, { at: Date.now(), value });
  return value;
}

export type SmartSuggestion = Awaited<ReturnType<typeof suggestedReports>>[number] & {
  state: SuggestionState;
  coveredBy: { id: string; title: string } | null;
};

/** Every suggestion with its state for this viewer (the catalog page shows all of them). */
export async function suggestionStates(
  requester: Requester,
  access: ReportsAccess,
  opts: { reports?: Array<{ report: ReportRow }> } = {},
): Promise<SmartSuggestion[]> {
  const [all, reports, states] = await Promise.all([
    feasibility(access),
    opts.reports ? Promise.resolve(opts.reports) : listReportsFor(requester, access),
    requester.userId
      ? agentDb().select<StateRow>("bi_report_suggestion_states", {
          filters: [eq("user_id", requester.userId)],
        })
      : Promise.resolve([] as StateRow[]),
  ]);
  const active = reports
    .map((x) => x.report)
    .filter((r) => r.status === "active" && !r.is_template);
  const stateBy = new Map(states.map((s) => [s.suggestion_key, s]));
  return all.map((s) => {
    const cover = active.find((r) =>
      reportCoversSuggestion(
        r as ReportRow & {
          origin_suggestion_key?: string | null;
          origin_template_key?: string | null;
        },
        s,
      ),
    );
    const st = stateBy.get(s.key);
    const feasible = s.status === "ready" || s.status === "ready_with_gaps";
    const state: SuggestionState = cover
      ? "completed"
      : st?.status === "dismissed"
        ? "dismissed"
        : !feasible
          ? "not_feasible"
          : st?.status === "in_progress" &&
              Date.now() - Date.parse(st.updated_at) < IN_PROGRESS_TTL_MS
            ? "in_progress"
            : "available";
    return { ...s, state, coveredBy: cover ? { id: cover.id, title: cover.title } : null };
  });
}

/** What the Reports home shows: only available or in-progress, feasible, non-template suggestions. */
export async function visibleSuggestions(
  requester: Requester,
  access: ReportsAccess,
  opts: { reports?: Array<{ report: ReportRow }> } = {},
) {
  return (await suggestionStates(requester, access, opts)).filter(
    (s) => !s.templateKey && (s.state === "available" || s.state === "in_progress"),
  );
}

async function upsertState(
  userId: string,
  key: string,
  status: StateRow["status"],
  reportId: string | null = null,
) {
  if (!SUGGESTED_REPORTS.some((s) => s.key === key))
    throw new ValidationError("Unknown suggestion.");
  const existing = await selectOne<StateRow>("bi_report_suggestion_states", {
    filters: [eq("user_id", userId), eq("suggestion_key", key)],
  });
  const patch = { status, report_id: reportId, updated_at: new Date().toISOString() };
  if (existing)
    await agentDb().update(
      "bi_report_suggestion_states",
      [eq("user_id", userId), eq("suggestion_key", key)],
      patch,
    );
  else
    await agentDb().insert("bi_report_suggestion_states", {
      user_id: userId,
      suggestion_key: key,
      ...patch,
    });
}

/** The user started building a suggestion with Dexter (not a completion — nothing is hidden yet). */
export async function markSuggestionStarted(userId: string, key: string) {
  await upsertState(userId, key, "in_progress");
}

export async function dismissSuggestion(userId: string, key: string) {
  await upsertState(userId, key, "dismissed");
}

export async function restoreSuggestion(userId: string, key: string) {
  if (!SUGGESTED_REPORTS.some((s) => s.key === key))
    throw new ValidationError("Unknown suggestion.");
  await agentDb().remove("bi_report_suggestion_states", [
    eq("user_id", userId),
    eq("suggestion_key", key),
  ]);
}

/**
 * Called after Dexter successfully saves a new report: link it to the suggestion the user was
 * building (if any) so the suggestion disappears. Only a *saved* report completes a suggestion.
 */
export async function linkNewReportToSuggestion(
  userId: string,
  report: ReportRow,
  explicitKey?: string | null,
): Promise<string | null> {
  let key =
    explicitKey && SUGGESTED_REPORTS.some((s) => s.key === explicitKey) ? explicitKey : null;
  if (!key) {
    const pending = (
      await agentDb().select<StateRow>("bi_report_suggestion_states", {
        filters: [eq("user_id", userId), eq("status", "in_progress")],
      })
    ).filter((s) => Date.now() - Date.parse(s.updated_at) < IN_PROGRESS_TTL_MS);
    // Prefer the in-progress suggestion this report actually matches; else the single pending one.
    key =
      pending.find((p) => specMatchesSuggestion(report.spec, p.suggestion_key))?.suggestion_key ??
      (pending.length === 1 ? pending[0]!.suggestion_key : null);
  }
  if (!key) return null;
  await agentDb().update("bi_reports", [eq("id", report.id)], { origin_suggestion_key: key });
  await upsertState(userId, key, "completed", report.id);
  return key;
}
