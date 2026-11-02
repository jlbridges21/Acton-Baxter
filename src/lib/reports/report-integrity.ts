/**
 * Cross-feature integrity checks for a saved report: field mappings, column identity and
 * formatting config, drill paths, reconciliation of executed numbers, and access boundaries.
 *
 *   checkSpecIntegrity(spec, catalog)  — static (pure): no data access
 *   auditReportIntegrity(...)          — static checks + execution with the viewer's access:
 *                                         grouped subtotals reconcile, restricted columns
 *                                         never appear in results or drills
 * Read-only: findings explain problems and suggest the fix; nothing is changed here.
 */

import { danglingRuleColumns, orphanedFormats } from "./column-format";
import type { CellValue } from "./compute";
import type { FieldCatalog } from "./fields";
import type { ExecutionResult, TableGroup, TableResult } from "./result-types";
import type { ReportSpec } from "./spec";

export type IntegrityFinding = {
  kind:
    | "missing_mapping"
    | "invalid_column_id"
    | "column_collision"
    | "stale_config"
    | "invalid_drill_path"
    | "reconciliation_failure"
    | "unauthorized_access";
  severity: "error" | "warning" | "info";
  widgetId: string | null;
  path: string;
  message: string;
  fix?: string;
};

type Resolve = FieldCatalog | ((ref: string) => { ok: boolean; key?: string; reason?: string });

/** Static checks over a parsed spec (column ids are assigned by the schema). */
export function checkSpecIntegrity(
  spec: ReportSpec,
  resolve: Resolve,
  opts: { rawSpec?: unknown } = {},
): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  const lookup =
    typeof resolve === "function" ? resolve : (ref: string) => resolveFromCatalog(resolve, ref);
  const rawWidgets = (opts.rawSpec as { widgets?: Array<Record<string, unknown>> } | undefined)
    ?.widgets;
  spec.widgets.forEach((w, wi) => {
    if (w.type !== "table") return;
    const base = `widgets[${wi}]`;
    // Explicit duplicate ids in the stored spec (the schema re-derives one of them).
    const raw = rawWidgets?.find((x) => x.id === w.id)?.columns as
      Array<{ id?: string }> | undefined;
    const explicit = (raw ?? []).map((c) => c.id).filter(Boolean) as string[];
    const dupIds = explicit.filter((id, i) => explicit.indexOf(id) !== i);
    for (const id of new Set(dupIds))
      out.push({
        kind: "column_collision",
        severity: "warning",
        widgetId: w.id,
        path: `${base}.columns`,
        message: `Two columns share the id "${id}"; the second one was given a new id, so its formatting may not apply.`,
        fix: "Save the report once to store the corrected ids, then re-check its formatting.",
      });
    // Two columns reading the same field (formatting is per column id, values are shared).
    const keys = new Map<string, string[]>();
    w.columns.forEach((c) => {
      const r = lookup(c.field);
      const key = r.ok && r.key ? r.key : c.field;
      keys.set(key, [...(keys.get(key) ?? []), c.id!]);
      if (!r.ok)
        out.push({
          kind: "missing_mapping",
          severity: "warning",
          widgetId: w.id,
          path: `${base}.columns[${w.columns.indexOf(c)}]`,
          message: r.reason ?? `Field "${c.field}" isn't available.`,
          fix: "Repair the field in Reports → Data settings → Field catalog, or remove the column.",
        });
    });
    for (const [key, ids] of keys)
      if (ids.length > 1)
        out.push({
          kind: "column_collision",
          severity: "info",
          widgetId: w.id,
          path: `${base}.columns`,
          message: `Columns ${ids.join(", ")} show the same field (${key}). They keep separate formatting by id, but hide/show and values are the same field.`,
        });
    const formats = w.appearance?.columnFormats;
    for (const id of orphanedFormats(formats, w.columns))
      out.push({
        kind: "stale_config",
        severity: "warning",
        widgetId: w.id,
        path: `${base}.appearance.columnFormats.${id}`,
        message: `Formatting for column "${id}" has no matching column (the column was removed or its id changed). It's ignored.`,
        fix: `Re-attach it with set_column_format on the right column, or remove it with prune_column_formats.`,
      });
    for (const d of danglingRuleColumns(formats, w.columns))
      out.push({
        kind: "invalid_column_id",
        severity: "warning",
        widgetId: w.id,
        path: `${base}.appearance.columnFormats.${d.column}.rules[${d.rule}].column`,
        message: `A conditional color on "${d.column}" reads column "${d.missing}", which isn't in the table. The rule never matches.`,
        fix: "Point the rule at an existing column id.",
      });
    for (const ref of Object.keys(w.appearance?.columns ?? {}))
      if (!w.columns.some((c) => c.field === ref))
        out.push({
          kind: "stale_config",
          severity: "info",
          widgetId: w.id,
          path: `${base}.appearance.columns.${ref}`,
          message: `Alignment for "${ref}" has no matching column.`,
        });
    if (w.drill) {
      for (const id of w.drill.columns ?? [])
        if (!w.columns.some((c) => c.id === id))
          out.push({
            kind: "invalid_column_id",
            severity: "error",
            widgetId: w.id,
            path: `${base}.drill.columns`,
            message: `Drill column "${id}" isn't a column of this table.`,
          });
      const source = spec.datasets.find((d) => d.id === w.dataset)?.source;
      if (w.drill.related && source && !w.drill.related.startsWith(`${source}.`))
        out.push({
          kind: "invalid_drill_path",
          severity: "error",
          widgetId: w.id,
          path: `${base}.drill.related`,
          message: `"${w.drill.related}" doesn't start from this table's source (${source}).`,
        });
    }
    const groupable =
      w.groupLevels.length > 0 ||
      spec.controls.some((c) => c.kind === "group_by" && c.widgets.includes(w.id));
    if (w.drill?.related && !groupable)
      out.push({
        kind: "invalid_drill_path",
        severity: "info",
        widgetId: w.id,
        path: `${base}.drill`,
        message: "Drill-downs open from group subtotals; this table has no grouping levels.",
      });
  });
  return out;
}

function resolveFromCatalog(catalog: FieldCatalog, ref: string) {
  let key = ref;
  if (ref.startsWith("sem:")) {
    const sem = catalog.semantic.get(ref);
    if (!sem?.ref || sem.unavailable)
      return {
        ok: false,
        reason: sem?.unavailable ?? `"${ref}" isn't mapped to a JobTread field.`,
      };
    key = sem.ref;
  }
  if (catalog.byKey.has(key)) return { ok: true, key };
  const off = catalog.unavailable?.get(key);
  if (off) return { ok: false, reason: off.message };
  const stale = catalog.stale?.get(key);
  if (stale) return { ok: false, reason: `“${stale.name}” (${key}) was removed from JobTread.` };
  if (ref.startsWith("calc:")) return { ok: true, key: ref };
  return { ok: false, reason: `Field "${ref}" doesn't exist in the connected JobTread data.` };
}

const num = (v: CellValue | undefined) => (typeof v === "number" ? v : 0);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

/**
 * Executed-result checks: for every grouped table, each additive (summed / counted) column's
 * group value equals the sum of its child groups, and the grand total equals the sum of the
 * top-level groups — unless records with several grouping values appear under several groups
 * (reported as info, not failure). Non-additive columns (averages, ratios) are skipped.
 */
export function checkResultIntegrity(
  spec: ReportSpec,
  result: Pick<ExecutionResult, "widgets">,
  opts: { allowedKeys?: Set<string> } = {},
): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  for (const w of spec.widgets) {
    const r = result.widgets[w.id];
    if (!r || r.kind !== "table" || w.type !== "table") continue;
    const t = r as TableResult;
    if (opts.allowedKeys)
      for (const c of t.columns)
        if (!opts.allowedKeys.has(c.key) && c.key !== "__lines")
          out.push({
            kind: "unauthorized_access",
            severity: "error",
            widgetId: w.id,
            path: `widgets.${w.id}.columns`,
            message: `Column "${c.label}" (${c.key}) was returned to a viewer without access to it.`,
          });
    if (!t.groups) continue;
    const additive = t.columns.filter((c) => {
      const col = w.columns.find((x) => x.id === c.columnId);
      const mode = col?.aggregate ?? "auto";
      return (
        c.type !== "percent" &&
        (mode === "sum" ||
          mode === "count" ||
          (mode === "auto" &&
            ["currency", "number", "sqft"].includes(c.type) &&
            !c.key.startsWith("calc:")))
      );
    });
    const multi = /several values in a grouping field/.test(t.message ?? "");
    const walk = (g: TableGroup) => {
      if (g.children.length)
        for (const c of additive) {
          const parent = g.values[c.key];
          if (typeof parent !== "number") continue;
          const sum = g.children.reduce((n, ch) => n + num(ch.values[c.key]), 0);
          if (!close(parent, sum))
            out.push({
              kind: "reconciliation_failure",
              severity: multi ? "info" : "error",
              widgetId: w.id,
              path: `widgets.${w.id}.groups.${g.id}.${c.key}`,
              message: multi
                ? `"${c.label}" for ${g.label}: child groups total ${sum}, the group ${parent} — records with several grouping values are counted under each child.`
                : `"${c.label}" for ${g.label} is ${parent}, but its child groups add up to ${sum}.`,
            });
        }
      g.children.forEach(walk);
    };
    t.groups.forEach(walk);
    if (t.totals && !t.message?.includes("first groups only"))
      for (const c of additive) {
        const total = t.totals[c.key];
        if (typeof total !== "number") continue;
        const sum = t.groups.reduce((n, g) => n + num(g.values[c.key]), 0);
        if (!close(total, sum))
          out.push({
            kind: "reconciliation_failure",
            severity: multi ? "info" : "error",
            widgetId: w.id,
            path: `widgets.${w.id}.totals.${c.key}`,
            message: multi
              ? `Grand total "${c.label}" counts each record once (${total}); the groups add up to ${sum} because some records appear in several groups.`
              : `Grand total "${c.label}" is ${total}, but the groups add up to ${sum}.`,
          });
      }
  }
  return out;
}
