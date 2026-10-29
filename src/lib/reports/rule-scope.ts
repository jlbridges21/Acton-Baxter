/**
 * Rule-set references inside report specs (shared by server, client, and templates).
 *
 * Templates never point at a live rule set. Their commission datasets and editors use the
 * reserved key below; a dashboard created from a template gets its own empty rule set (or a
 * copy / shared attachment the person chose explicitly) and the spec is rewritten to it.
 * A saved (non-template) report that still uses the reserved key gets a fresh empty
 * dashboard rule set on save — that is how Dexter starts a commission dashboard empty.
 */

import type { ReportSpec } from "./spec";

/** Reserved; never stored as a rule-set key (generated keys are `rs_…`). */
export const TEMPLATE_RULE_SET_KEY = "new-dashboard-rules";

/** Every rule-set key a spec references (datasets and editor widgets), in order, unique. */
export function ruleSetKeysIn(spec: Pick<ReportSpec, "datasets" | "widgets">): string[] {
  const keys: string[] = [];
  for (const d of spec.datasets) if (d.ruleSet) keys.push(d.ruleSet);
  for (const w of spec.widgets)
    if ((w.type === "rate_editor" || w.type === "assignment_editor") && w.ruleSet)
      keys.push(w.ruleSet);
  return [...new Set(keys)];
}

/** Replace rule-set keys in a spec (keys missing from the map are left as they are). */
export function rewriteRuleSetKeys<T extends Pick<ReportSpec, "datasets" | "widgets">>(
  spec: T,
  map: Map<string, string> | ((key: string) => string),
): T {
  const swap = (key: string) => (typeof map === "function" ? map(key) : (map.get(key) ?? key));
  return {
    ...spec,
    datasets: spec.datasets.map((d) => (d.ruleSet ? { ...d, ruleSet: swap(d.ruleSet) } : d)),
    widgets: spec.widgets.map((w) =>
      (w.type === "rate_editor" || w.type === "assignment_editor") && w.ruleSet
        ? { ...w, ruleSet: swap(w.ruleSet) }
        : w,
    ),
  };
}

/** A template's spec as it must run: every rule-set reference points at the placeholder. */
export function templateSafeSpec<T extends Pick<ReportSpec, "datasets" | "widgets">>(spec: T): T {
  return rewriteRuleSetKeys(spec, () => TEMPLATE_RULE_SET_KEY);
}
