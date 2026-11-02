/**
 * Drill-down reconciliation (pure). A drill view shows the records behind an aggregate and
 * proves its numbers add up:
 *
 *   additive metrics (sum, count): the parent equals the sum of its child groups' values,
 *     unless records with several values in the next grouping field appear under each value
 *     (then the overlap is reported, never hidden);
 *   non-additive metrics (average, min/max, distinct count, percentages, ratios / aggregate
 *     formulas): the parent is recomputed from its own records — child values are shown but
 *     never summed, and the view says so.
 *
 * Every value is computed from records, exactly like grouped-table subtotals.
 */

import { groupRows, type CellValue, type Row } from "./compute";
import { summarizeGroup, type GroupColumn, type GroupColumnMode } from "./grouping";

export const DRILL_PAGE_MAX = 200;

/** Whether child values of this metric may be added up to the parent's. */
export function isAdditive(mode: GroupColumnMode, type?: string): boolean {
  if (type === "percent") return false;
  return mode === "sum" || mode === "count";
}

export const NON_ADDITIVE_REASON: Record<string, string> = {
  avg: "Averages are recomputed from the group's records (an average of averages would be wrong).",
  min: "The lowest value is taken from the group's records.",
  max: "The highest value is taken from the group's records.",
  count_distinct:
    "Distinct counts are recomputed from the group's records (the same value can appear in several child groups).",
  formula:
    "This calculated field is recomputed from the group's records (weighted), not added up from child groups.",
  percent: "Percentages are recomputed from records, never summed.",
};

export type Reconciliation = {
  columnKey: string;
  mode: GroupColumnMode;
  additive: boolean;
  parent: CellValue;
  /** Sum of child values (additive metrics only). */
  childrenTotal: number | null;
  /** Records counted under more than one child group (multi-value grouping fields). */
  overlap: number;
  status: "reconciled" | "overlap" | "mismatch" | "recomputed" | "not_applicable";
  message: string;
};

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

/**
 * Children of `rows` at the next grouping level, each with its value of `column`, plus the
 * reconciliation of those values against the parent's.
 */
export function reconcileChildren(
  rows: Row[],
  nextLevelKey: string | null,
  column: GroupColumn & { type?: string },
): {
  children: Array<{ label: string; count: number; value: CellValue }>;
  reconciliation: Reconciliation;
} {
  const parent = summarizeGroup(rows, [column]).values[column.key] ?? null;
  const additive = isAdditive(column.mode, column.type);
  if (!nextLevelKey || column.mode === "none") {
    return {
      children: [],
      reconciliation: {
        columnKey: column.key,
        mode: column.mode,
        additive,
        parent,
        childrenTotal: null,
        overlap: 0,
        status: column.mode === "none" ? "not_applicable" : "recomputed",
        message:
          column.mode === "none"
            ? "This column isn't totaled."
            : "Computed from the records listed below.",
      },
    };
  }
  const groups = groupRows(rows, nextLevelKey);
  const children = [...groups.entries()].map(([label, list]) => ({
    label,
    count: list.length,
    value: summarizeGroup(list, [column]).values[column.key] ?? null,
  }));
  const placements = children.reduce((n, c) => n + c.count, 0);
  const overlap = placements - rows.length;
  if (!additive) {
    return {
      children,
      reconciliation: {
        columnKey: column.key,
        mode: column.mode,
        additive,
        parent,
        childrenTotal: null,
        overlap,
        status: "recomputed",
        message:
          NON_ADDITIVE_REASON[column.type === "percent" ? "percent" : column.mode] ??
          "Recomputed from the group's records.",
      },
    };
  }
  const childrenTotal = children.reduce(
    (n, c) => n + (typeof c.value === "number" ? c.value : 0),
    0,
  );
  const p = typeof parent === "number" ? parent : 0;
  const status: Reconciliation["status"] = close(p, childrenTotal)
    ? "reconciled"
    : overlap > 0
      ? "overlap"
      : "mismatch";
  return {
    children,
    reconciliation: {
      columnKey: column.key,
      mode: column.mode,
      additive,
      parent,
      childrenTotal: Math.round(childrenTotal * 1e6) / 1e6,
      overlap,
      status,
      message:
        status === "reconciled"
          ? "The child groups add up to this total."
          : status === "overlap"
            ? `${overlap} record(s) have several values in the next grouping field and appear under each, so the child groups add up to more than this total. The total counts each record once.`
            : "The child groups don't add up to this total. Please report this report to an administrator.",
    },
  };
}

/** Keep only records in the group at `path` (labels from the top grouping level down). */
export function rowsAtPath(rows: Row[], levelKeys: string[], path: string[]): Row[] {
  let out = rows;
  path.forEach((label, i) => {
    const key = levelKeys[i]!;
    out = groupRows(out, key).get(label) ?? [];
  });
  return out;
}
