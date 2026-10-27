/**
 * Saved personal views: a viewer's own control state for a report (grouping, sorting,
 * metric choice, filters). Views belong to one person and never change the report's
 * published defaults, which only editors change by saving a new report version.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ControlState } from "./result-types";
import type { ReportSpec } from "./spec";

export type SavedViewRow = {
  id: string;
  report_id: string;
  user_id: string;
  name: string;
  state: ControlState;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

/** Keep only values for this report's controls, in the shapes controls accept. */
export function sanitizeViewState(spec: ReportSpec, raw: unknown): ControlState {
  if (!raw || typeof raw !== "object") return {};
  const ids = new Set(spec.controls.map((c) => c.id));
  const out: ControlState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(k)) continue;
    if (v === null || typeof v === "string")
      out[k] = typeof v === "string" ? v.slice(0, 200) : null;
    else if (
      Array.isArray(v) &&
      v.length <= 50 &&
      v.every((x) => x === null || typeof x === "string" || typeof x === "number")
    )
      out[k] = v.map((x) => (typeof x === "string" ? x.slice(0, 200) : x)) as ControlState[string];
  }
  return out;
}

export async function listSavedViews(reportId: string, userId: string): Promise<SavedViewRow[]> {
  return agentDb()
    .select<SavedViewRow>("bi_report_saved_views", {
      filters: [eq("report_id", reportId), eq("user_id", userId)],
      order: { col: "name" },
      limit: 50,
    })
    .catch(() => []);
}

export async function saveView(input: {
  reportId: string;
  userId: string;
  spec: ReportSpec;
  name: string;
  state: unknown;
  isDefault?: boolean;
}): Promise<SavedViewRow> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new ValidationError("Name the view.");
  const db = agentDb();
  if (input.isDefault)
    await db.update(
      "bi_report_saved_views",
      [eq("report_id", input.reportId), eq("user_id", input.userId)],
      { is_default: false },
    );
  const [row] = await db.upsert<SavedViewRow>(
    "bi_report_saved_views",
    {
      report_id: input.reportId,
      user_id: input.userId,
      name,
      state: sanitizeViewState(input.spec, input.state),
      is_default: Boolean(input.isDefault),
      updated_at: new Date().toISOString(),
    },
    ["report_id", "user_id", "name"],
  );
  return row!;
}

export async function deleteView(input: { id: string; reportId: string; userId: string }) {
  const rows = await agentDb().select<SavedViewRow>("bi_report_saved_views", {
    filters: [eq("id", input.id), eq("report_id", input.reportId), eq("user_id", input.userId)],
  });
  if (!rows.length) throw new NotFoundError("View not found");
  await agentDb().remove("bi_report_saved_views", [eq("id", input.id)]);
}
