/**
 * Deterministic "does this report already cover that suggestion?" checks — no AI calls.
 *
 * A report covers a suggestion when (in order):
 *   1. it was built from that suggestion (origin_suggestion_key), or
 *   2. it was copied from the suggestion's template (origin_template_key / template_key), or
 *   3. its definition analyses the same thing: the suggestion's data source plus the grouping
 *      dimensions / measures that define it (e.g. PM Workload = jobs grouped by project manager
 *      AND phase). A report merely *named* similarly does not count.
 */

import { collectFieldRefs, type ReportSpec } from "./spec";

type Signature = {
  /** Data sources at least one of which the report must use. */
  sources?: string[];
  /** Every entry must be satisfied by a grouping dimension (chart/table group, select control). */
  groupedBy?: RegExp[];
  /** Every entry must match some referenced field. */
  uses?: RegExp[];
  /** Widget types the report must contain. */
  widgets?: string[];
};

export const SUGGESTION_SIGNATURES: Record<string, Signature | null> = {
  active_portfolio: { sources: ["jobs"], groupedBy: [/^sem:phase$/, /^sem:project_manager$/] },
  design_handoff: { widgets: ["milestones", "documents"] },
  milestone_tracker: { widgets: ["milestones"] },
  pm_workload: { sources: ["jobs"], groupedBy: [/^sem:project_manager$/, /^sem:phase$/] },
  model_comparison: { sources: ["catalog_models"], uses: [/^model\.(basePrice|marginPct)$/] },
  cost_per_sqft: { sources: ["jobs"], uses: [/total_sqft/, /(price|order|revenue)/i] },
  profitability: {
    sources: ["jobs", "commissions"],
    uses: [/(gross_?profit|grossProfit|margin)/i],
  },
  sales_performance: {
    groupedBy: [/^(sem:sales_rep|com\.salesperson)$/],
    uses: [/(gross_?profit|grossProfit|order_price|orderPrice)/i],
  },
  commissions: { sources: ["commissions"] },
  permitting_pipeline: { groupedBy: [/^sem:permit_status$/] },
  design_hours: { uses: [/hours/i] },
  // Too generic to recognize from content; only an origin link counts.
  field_explorer: null,
};

function groupingFields(spec: ReportSpec): string[] {
  const out: string[] = [];
  for (const c of spec.controls) if (c.kind === "select") out.push(c.field);
  for (const w of spec.widgets) {
    if (w.type === "chart") [w.groupBy, w.seriesBy].forEach((f) => f && out.push(f));
    if (w.type === "table" && w.groupBy) out.push(w.groupBy);
  }
  return out;
}

export function specMatchesSuggestion(spec: ReportSpec, key: string): boolean {
  const sig = SUGGESTION_SIGNATURES[key];
  if (!sig) return false;
  const sources = new Set(spec.datasets.map((d) => d.source));
  if (sig.sources && !sig.sources.some((s) => sources.has(s as never))) return false;
  if (sig.widgets && !sig.widgets.every((t) => spec.widgets.some((w) => w.type === t)))
    return false;
  const groups = groupingFields(spec);
  if (sig.groupedBy && !sig.groupedBy.every((re) => groups.some((g) => re.test(g)))) return false;
  const refs = collectFieldRefs(spec);
  if (sig.uses && !sig.uses.every((re) => refs.some((r) => re.test(r)))) return false;
  return Boolean(sig.sources || sig.widgets || sig.groupedBy || sig.uses);
}

export type CoverageReport = {
  spec: ReportSpec;
  origin_suggestion_key?: string | null;
  origin_template_key?: string | null;
  template_key?: string | null;
};

export function reportCoversSuggestion(
  report: CoverageReport,
  s: { key: string; templateKey?: string },
): boolean {
  if (report.origin_suggestion_key === s.key) return true;
  if (
    s.templateKey &&
    (report.origin_template_key === s.templateKey || report.template_key === s.templateKey)
  )
    return true;
  return specMatchesSuggestion(report.spec, s.key);
}
