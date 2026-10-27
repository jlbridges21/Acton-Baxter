/**
 * Nested table groups (e.g. Phase → Project Manager → Job) with subtotals and a grand total.
 *
 * Every subtotal is computed from the underlying records of that group, never by adding up
 * child subtotals, so averages, distinct counts, and aggregate formulas (weighted margins)
 * stay correct at every level. Blank values are excluded from sums and the group notes how
 * many records lacked a value instead of treating blanks as zero.
 */

import { aggregate, groupRows, BLANK_LABEL, type CellValue, type Row } from "./compute";
import type { TableGroup } from "./result-types";

export type GroupColumnMode =
  "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "formula" | "none";

export type GroupColumn = {
  key: string;
  mode: GroupColumnMode;
  /** For "formula": an aggregate calculation evaluated over the group's records. */
  evaluate?: (rows: Row[]) => number | null;
};

export const MAX_GROUP_NODES = 1500;

export function summarizeGroup(
  rows: Row[],
  columns: GroupColumn[],
): { values: Record<string, CellValue>; incomplete: Record<string, number> } {
  const values: Record<string, CellValue> = {};
  const incomplete: Record<string, number> = {};
  for (const c of columns) {
    if (c.mode === "none") continue;
    if (c.mode === "formula") {
      values[c.key] = c.evaluate ? c.evaluate(rows) : null;
      continue;
    }
    const agg = aggregate(rows, { op: c.mode, field: c.key });
    values[c.key] = agg.value;
    if (c.mode !== "count" && agg.blank) incomplete[c.key] = agg.blank;
  }
  return { values, incomplete };
}

/**
 * Build the group tree. Groups sort by label (blank last) unless `sort` names a column with
 * a group value, in which case groups sort by that value. Records inside the deepest groups
 * keep the order they arrive in.
 */
export function buildGroupTree(
  rows: Row[],
  levels: Array<{ key: string; label: string }>,
  columns: GroupColumn[],
  opts: { sort?: { key: string; dir: "asc" | "desc" } } = {},
): {
  groups: TableGroup[];
  totals: Record<string, CellValue>;
  totalsIncomplete: Record<string, number>;
  orderedRows: Row[];
  truncated: boolean;
} {
  let nodes = 0;
  let truncated = false;
  const ordered: Row[] = [];
  const seen = new Set<string>();
  const sortCol = opts.sort
    ? columns.find((c) => c.key === opts.sort!.key && c.mode !== "none")
    : undefined;

  const build = (subset: Row[], depth: number, path: string[]): TableGroup[] => {
    const level = levels[depth]!;
    const groups = [...groupRows(subset, level.key).entries()].map(([label, groupRowsList]) => {
      const { values, incomplete } = summarizeGroup(groupRowsList, columns);
      return { label, rows: groupRowsList, values, incomplete };
    });
    groups.sort((a, b) => {
      if (sortCol) {
        const av = a.values[sortCol.key];
        const bv = b.values[sortCol.key];
        const an = typeof av === "number" ? av : null;
        const bn = typeof bv === "number" ? bv : null;
        if (an !== bn) {
          if (an === null) return 1;
          if (bn === null) return -1;
          return (opts.sort!.dir === "asc" ? 1 : -1) * (an - bn);
        }
      }
      if (a.label === BLANK_LABEL) return 1;
      if (b.label === BLANK_LABEL) return -1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    const out: TableGroup[] = [];
    for (const g of groups) {
      if (++nodes > MAX_GROUP_NODES) {
        truncated = true;
        break;
      }
      const id = JSON.stringify([...path, g.label]);
      const leaf = depth === levels.length - 1;
      const node: TableGroup = {
        id,
        level: depth,
        field: level.key,
        fieldLabel: level.label,
        label: g.label,
        count: g.rows.length,
        values: g.values,
        ...(Object.keys(g.incomplete).length ? { incomplete: g.incomplete } : {}),
        children: leaf ? [] : build(g.rows, depth + 1, [...path, g.label]),
        rowIds: leaf ? g.rows.map((r) => r.id) : [],
      };
      if (leaf)
        for (const r of g.rows)
          if (!seen.has(r.id)) {
            seen.add(r.id);
            ordered.push(r);
          }
      out.push(node);
    }
    return out;
  };

  const groups = levels.length ? build(rows, 0, []) : [];
  const total = summarizeGroup(rows, columns);
  return {
    groups,
    totals: total.values,
    totalsIncomplete: total.incomplete,
    orderedRows: ordered,
    truncated,
  };
}
