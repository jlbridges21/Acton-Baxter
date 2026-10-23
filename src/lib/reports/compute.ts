/**
 * Deterministic report calculations (pure functions, no I/O).
 *
 * All numbers shown in Reports come from here — never from a language model.
 * Conventions:
 *   - Blank values (null, "", []) are excluded from sum/avg/min/max/median and counted as
 *     "(blank)" when grouping.
 *   - Multi-value fields (JobTread option fields) contribute a row to each of its values
 *     when grouping; provenance notes say so.
 *   - Averages divide by the number of non-blank values, not the row count.
 */

import type { Condition, Metric } from "./spec";

export type CellValue = string | number | boolean | null | string[];
export type Row = { id: string; [field: string]: CellValue };

export const BLANK_LABEL = "(blank)";

export function isBlank(v: CellValue | undefined): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

export function asList(v: CellValue | undefined): string[] {
  if (isBlank(v)) return [];
  if (Array.isArray(v)) return v;
  return [String(v)];
}

export function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(v) && v.length === 1) return asNumber(v[0]);
  return null;
}

function norm(v: unknown): string {
  return String(v).trim().toLowerCase();
}

/** Evaluate one condition against a cell. Comparisons are numeric when both sides are numbers, else date/lexical. */
export function matchesCondition(value: CellValue | undefined, cond: Condition): boolean {
  const target = cond.value;
  const list = asList(value);
  const targets = Array.isArray(target) ? target : target === undefined ? [] : [target];
  switch (cond.op) {
    case "blank":
      return isBlank(value);
    case "not_blank":
      return !isBlank(value);
    case "eq":
      return typeof value === "boolean"
        ? value === (target === true || norm(target) === "true")
        : list.some((v) => norm(v) === norm(target));
    case "neq":
      return typeof value === "boolean"
        ? value !== (target === true || norm(target) === "true")
        : !list.some((v) => norm(v) === norm(target));
    case "in":
      return list.some((v) => targets.some((t) => norm(v) === norm(t)));
    case "not_in":
      return !list.some((v) => targets.some((t) => norm(v) === norm(t)));
    case "contains":
      return list.some((v) => norm(v).includes(norm(target)));
    case "not_contains":
      return !list.some((v) => norm(v).includes(norm(target)));
    case "starts_with":
      return list.some((v) => norm(v).startsWith(norm(target)));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (isBlank(value) || target === undefined) return false;
      const a = asNumber(value);
      const b = asNumber(target as CellValue);
      const cmp =
        a !== null && b !== null
          ? a - b
          : String(Array.isArray(value) ? value[0] : value).localeCompare(String(target));
      return cond.op === "gt"
        ? cmp > 0
        : cond.op === "gte"
          ? cmp >= 0
          : cond.op === "lt"
            ? cmp < 0
            : cmp <= 0;
    }
  }
}

export function filterRows(rows: Row[], conditions: Condition[]): Row[] {
  if (conditions.length === 0) return rows;
  return rows.filter((r) => conditions.every((c) => matchesCondition(r[c.field], c)));
}

export function aggregate(
  rows: Row[],
  metric: Metric,
): { value: number | null; counted: number; blank: number } {
  if (metric.op === "count") return { value: rows.length, counted: rows.length, blank: 0 };
  const field = metric.field!;
  if (metric.op === "count_distinct") {
    const set = new Set<string>();
    let blank = 0;
    for (const r of rows) {
      const vs = asList(r[field]);
      if (vs.length === 0) blank++;
      vs.forEach((v) => set.add(norm(v)));
    }
    return { value: set.size, counted: rows.length - blank, blank };
  }
  const nums: number[] = [];
  for (const r of rows) {
    const n = asNumber(r[field]);
    if (n !== null) nums.push(n);
  }
  const blank = rows.length - nums.length;
  if (nums.length === 0) return { value: null, counted: 0, blank };
  let value: number;
  switch (metric.op) {
    case "sum":
      value = nums.reduce((s, n) => s + n, 0);
      break;
    case "avg":
      value = nums.reduce((s, n) => s + n, 0) / nums.length;
      break;
    case "min":
      value = Math.min(...nums);
      break;
    case "max":
      value = Math.max(...nums);
      break;
    case "median": {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      break;
    }
    default:
      value = nums.length;
  }
  // Avoid binary float noise in currency sums (e.g. 0.1 + 0.2).
  return { value: Math.round(value * 1e6) / 1e6, counted: nums.length, blank };
}

export type Bucket = "day" | "month" | "quarter" | "year";

export function bucketDate(value: string, bucket: Bucket): string {
  const d = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return value;
  const [y, m] = d.split("-");
  if (bucket === "day") return d;
  if (bucket === "month") return `${y}-${m}`;
  if (bucket === "quarter") return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
  return y!;
}

export function groupKeys(row: Row, field: string, bucket?: Bucket): string[] {
  const vs = asList(row[field]);
  if (vs.length === 0) {
    const v = row[field];
    if (typeof v === "boolean") return [v ? "Yes" : "No"];
    return [BLANK_LABEL];
  }
  return [...new Set(vs.map((v) => (bucket ? bucketDate(v, bucket) : v)))];
}

export function groupRows(rows: Row[], field: string, bucket?: Bucket): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    for (const key of groupKeys(r, field, bucket)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
  }
  return groups;
}

export type ChartPoint = {
  key: string;
  value: number | null;
  count: number;
  series?: Record<string, number | null>;
  isOther?: boolean;
};

export function computeSeries(input: {
  rows: Row[];
  groupBy: string;
  metric: Metric;
  seriesBy?: string;
  bucket?: Bucket;
  sort: "value_desc" | "value_asc" | "label";
  limit: number;
  /** Date buckets read naturally in chronological order. */
  chronological?: boolean;
}): { points: ChartPoint[]; seriesKeys: string[]; multiValueNote: boolean } {
  const groups = groupRows(input.rows, input.groupBy, input.bucket);
  const multiValueNote = input.rows.some(
    (r) => Array.isArray(r[input.groupBy]) && (r[input.groupBy] as string[]).length > 1,
  );
  const seriesKeys = new Set<string>();
  let points: ChartPoint[] = [...groups.entries()].map(([key, rows]) => {
    const point: ChartPoint = {
      key,
      value: aggregate(rows, input.metric).value,
      count: rows.length,
    };
    if (input.seriesBy) {
      point.series = {};
      for (const [s, srows] of groupRows(rows, input.seriesBy)) {
        seriesKeys.add(s);
        point.series[s] = aggregate(srows, input.metric).value;
      }
    }
    return point;
  });
  const byLabel = (a: ChartPoint, b: ChartPoint) =>
    a.key === BLANK_LABEL
      ? 1
      : b.key === BLANK_LABEL
        ? -1
        : a.key.localeCompare(b.key, undefined, { numeric: true });
  if (input.chronological || input.sort === "label") points.sort(byLabel);
  else
    points.sort(
      (a, b) =>
        (input.sort === "value_asc" ? 1 : -1) * ((a.value ?? -Infinity) - (b.value ?? -Infinity)) ||
        byLabel(a, b),
    );
  if (points.length > input.limit && !input.chronological) {
    const kept = points.slice(0, input.limit - 1);
    const rest = points.slice(input.limit - 1);
    // "Other" re-aggregates the underlying rows (not the per-group results) so averages stay correct.
    const restRows = [...new Set(rest.flatMap((p) => groups.get(p.key) ?? []))];
    kept.push({
      key: `Other (${rest.length})`,
      value: aggregate(restRows, input.metric).value,
      count: restRows.length,
      isOther: true,
    });
    points = kept;
  }
  return { points, seriesKeys: [...seriesKeys].sort(), multiValueNote };
}

/** Histogram bins for a numeric field (Sturges' rule, capped). */
export function computeHistogram(rows: Row[], field: string, maxBins = 12): ChartPoint[] {
  const nums = rows.map((r) => asNumber(r[field])).filter((n): n is number => n !== null);
  if (nums.length === 0) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [{ key: String(min), value: nums.length, count: nums.length }];
  const bins = Math.min(maxBins, Math.max(3, Math.ceil(Math.log2(nums.length) + 1)));
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const n of nums) counts[Math.min(bins - 1, Math.floor((n - min) / width))]!++;
  return counts.map((c, i) => {
    const lo = min + i * width;
    const hi = i === bins - 1 ? max : lo + width;
    return { key: `${Math.round(lo)}–${Math.round(hi)}`, value: c, count: c };
  });
}

export function sortRows(rows: Row[], sort: Array<{ field: string; dir: "asc" | "desc" }>): Row[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const av = a[s.field];
      const bv = b[s.field];
      if (isBlank(av) && isBlank(bv)) continue;
      if (isBlank(av)) return 1; // blanks last regardless of direction
      if (isBlank(bv)) return -1;
      const an = asNumber(av);
      const bn = asNumber(bv);
      const cmp =
        an !== null && bn !== null
          ? an - bn
          : asList(av)
              .join(", ")
              .localeCompare(asList(bv).join(", "), undefined, { numeric: true });
      if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

/** Rows a chart segment / KPI represents (for drilldown). */
export function rowsForGroup(rows: Row[], field: string, key: string, bucket?: Bucket): Row[] {
  return rows.filter((r) => groupKeys(r, field, bucket).includes(key));
}

export function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  });
}

/** Model name → series + code ("i+ 998-B-1" → i+, 998-B-1; "Age in Place - 498-A-1" → Age in Place, 498-A-1). */
export function parseModelName(name: string): { series: string; code: string } {
  const dash = name.indexOf(" - ");
  if (dash > 0) return { series: name.slice(0, dash).trim(), code: name.slice(dash + 3).trim() };
  const space = name.indexOf(" ");
  if (space > 0) return { series: name.slice(0, space).trim(), code: name.slice(space + 1).trim() };
  return { series: name, code: "" };
}
