/**
 * Table column identity and formatting (pure; shared by the server, the column editor, the
 * renderer, and Dexter).
 *
 * Identity: every table column has a stable `id`. Columns saved before ids existed get a
 * deterministic one derived from the field and its occurrence (the second `job.name` column is
 * `job_name_2`), so the same legacy report always yields the same ids, and the first save
 * stores them. When a widget's columns are regenerated (Dexter `update_widget`, the builder),
 * columns without an id inherit the id of the previous column with the same field, then the
 * same label — so formatting follows the column through regeneration, reordering, relabeling,
 * and a field repair that rewrites its ref.
 *
 * Formatting lives in `appearance.columnFormats[<column id>]` and is presentation only: it
 * never changes values, formulas, filters, sorting, or exports. Conditional rules evaluate the
 * raw cell value (numbers as numbers), never the formatted text.
 */

import {
  ALIGNS,
  cellRuleSchema,
  COLUMN_ID,
  columnFormatSchema,
  columnFormatsSchema,
  columnIdSchema,
  NEGATIVE_STYLES,
  NUMBER_STYLES,
  numberFormatSchema,
  ruleMatches,
  type CellRule,
  type ColumnFormat,
  type ConditionalRule,
} from "./style";

export {
  ALIGNS,
  cellRuleSchema,
  COLUMN_ID,
  columnFormatSchema,
  columnFormatsSchema,
  columnIdSchema,
  NEGATIVE_STYLES,
  NUMBER_STYLES,
  numberFormatSchema,
  type CellRule,
  type ColumnFormat,
};

/** Built-in presets offered by the column editor and Dexter ("format as currency"). */
export const COLUMN_PRESETS: Record<string, { label: string; format: ColumnFormat }> = {
  currency: {
    label: "Currency",
    format: {
      number: { style: "currency", decimals: 0, thousands: true },
      cell: { align: "right" },
    },
  },
  currency_cents: {
    label: "Currency (cents)",
    format: {
      number: { style: "currency", decimals: 2, thousands: true },
      cell: { align: "right" },
    },
  },
  percent: {
    label: "Percent",
    format: { number: { style: "percent", decimals: 1 }, cell: { align: "right" } },
  },
  whole_number: {
    label: "Whole number",
    format: { number: { style: "number", decimals: 0, thousands: true }, cell: { align: "right" } },
  },
  negatives_red: {
    label: "Negatives in red",
    format: { number: { negative: "red_parens" } },
  },
  emphasis: {
    label: "Emphasis",
    format: { header: { bold: true }, cell: { bold: true } },
  },
  highlight_header: {
    label: "Highlighted header",
    format: { header: { background: "token:accent", text: "#ffffff", bold: true } },
  },
  muted: { label: "Muted", format: { cell: { text: "token:muted" } } },
};

// ── Identity ────────────────────────────────────────────────────────────────────────────

/** Deterministic slug for a field ref: "cf:22PgDDbm" → "cf_22pgddbm", "calc:margin" → "calc_margin". */
export function slugForField(field: string): string {
  const s = field
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(s) ? s : `c_${s}`.slice(0, 40);
}

type ColumnLike = { id?: string; field: string; label?: string };

/**
 * Give every column a stable, unique id.
 *   1. keep an explicit id (first use wins; a duplicate explicit id is re-derived),
 *   2. else inherit from `previous` columns by field, then by label (each previous id once),
 *   3. else derive `<field slug>` / `<field slug>_<n>` deterministically.
 */
export function assignColumnIds<T extends ColumnLike>(
  columns: T[],
  previous: ColumnLike[] = [],
): Array<T & { id: string }> {
  const used = new Set<string>();
  const out: Array<T & { id: string }> = new Array(columns.length);
  // id first, matching the schema's key order, so re-parsing a spec is byte-for-byte stable.
  const withId = (c: T, id: string) => {
    const { id: _old, ...rest } = c;
    void _old;
    return { id, ...rest } as T & { id: string };
  };
  const pending: number[] = [];
  columns.forEach((c, i) => {
    if (c.id && COLUMN_ID.test(c.id) && !used.has(c.id)) {
      used.add(c.id);
      out[i] = withId(c, c.id);
    } else pending.push(i);
  });
  const prev = previous.filter((p) => p.id && !used.has(p.id));
  const take = (match: (p: ColumnLike) => boolean) => {
    const idx = prev.findIndex((p) => match(p) && !used.has(p.id!));
    if (idx < 0) return null;
    const id = prev[idx]!.id!;
    prev.splice(idx, 1);
    used.add(id);
    return id;
  };
  const still: number[] = [];
  for (const i of pending) {
    const c = columns[i]!;
    const id = take((p) => p.field === c.field);
    if (id) out[i] = withId(c, id);
    else still.push(i);
  }
  const rest: number[] = [];
  for (const i of still) {
    const c = columns[i]!;
    const label = c.label?.trim().toLowerCase();
    const id = label ? take((p) => (p.label ?? "").trim().toLowerCase() === label) : null;
    if (id) out[i] = withId(c, id);
    else rest.push(i);
  }
  const seen = new Map<string, number>();
  for (const i of rest) {
    const c = columns[i]!;
    const base = slugForField(c.field);
    let n = (seen.get(base) ?? 0) + 1;
    let id = n === 1 ? base : `${base}_${n}`;
    while (used.has(id)) id = `${base}_${++n}`;
    seen.set(base, n);
    used.add(id);
    out[i] = withId(c, id);
  }
  return out;
}

/**
 * Find a column the way a person names it: id, field ref, label (as shown), or the field's
 * catalog label. Several matches are ambiguous — returned, never guessed.
 */
export function findColumn(
  columns: Array<{ id: string; field: string; label?: string }>,
  query: string,
  fieldLabel: (field: string) => string | undefined = () => undefined,
):
  | { status: "found"; id: string }
  | { status: "ambiguous"; ids: string[]; message: string }
  | { status: "not_found"; message: string } {
  const q = query.trim();
  const n = q.toLowerCase();
  const tiers = [
    columns.filter((c) => c.id === q),
    columns.filter((c) => c.field === q),
    columns.filter((c) => (c.label ?? "").trim().toLowerCase() === n),
    columns.filter((c) => !c.label && (fieldLabel(c.field) ?? "").trim().toLowerCase() === n),
    columns.filter(
      (c) => (c.label ?? fieldLabel(c.field) ?? "").toLowerCase().includes(n) && n.length >= 3,
    ),
  ];
  for (const t of tiers) {
    if (t.length === 1) return { status: "found", id: t[0]!.id };
    if (t.length > 1)
      return {
        status: "ambiguous",
        ids: t.map((c) => c.id),
        message: `"${q}" matches ${t.length} columns: ${t
          .map((c) => `${c.label ?? fieldLabel(c.field) ?? c.field} (id ${c.id})`)
          .join(", ")}. Say which one by its id.`,
      };
  }
  return {
    status: "not_found",
    message: `No column matches "${q}". Columns: ${columns
      .map((c) => `${c.label ?? fieldLabel(c.field) ?? c.field} (id ${c.id})`)
      .join(", ")}.`,
  };
}

// ── Config maintenance ──────────────────────────────────────────────────────────────────

/** Merge a patch into a column format (nested objects merge; `null` clears a key). */
export function mergeColumnFormat(
  base: ColumnFormat | undefined,
  patch: Record<string, unknown>,
): ColumnFormat {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === "object" &&
      !Array.isArray(out[k])
    ) {
      const merged: Record<string, unknown> = { ...(out[k] as Record<string, unknown>) };
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>))
        if (v2 === null) delete merged[k2];
        else merged[k2] = v2;
      out[k] = merged;
    } else out[k] = v;
  }
  return columnFormatSchema.parse(out);
}

/** Column format ids that no longer match a column (deleted columns). Ignored when rendering. */
export function orphanedFormats(
  formats: Record<string, unknown> | undefined,
  columns: Array<{ id?: string }>,
): string[] {
  const ids = new Set(columns.map((c) => c.id));
  return Object.keys(formats ?? {}).filter((k) => !ids.has(k));
}

/** Cell rules pointing at a column id that doesn't exist (stale config). */
export function danglingRuleColumns(
  formats: Record<string, ColumnFormat> | undefined,
  columns: Array<{ id?: string }>,
): Array<{ column: string; rule: number; missing: string }> {
  const ids = new Set(columns.map((c) => c.id));
  const out: Array<{ column: string; rule: number; missing: string }> = [];
  for (const [col, f] of Object.entries(formats ?? {}))
    (f.rules ?? []).forEach((r, i) => {
      if (r.column && !ids.has(r.column)) out.push({ column: col, rule: i, missing: r.column });
    });
  return out;
}

// ── Rendering helpers (presentation only) ───────────────────────────────────────────────

export type CellPaint = {
  background?: string;
  text?: string;
  bold?: boolean;
  align?: (typeof ALIGNS)[number];
  negative?: boolean;
};

/**
 * Format a raw value with a column's number format. Returns null when the format doesn't apply
 * (non-numbers, or no number format) so the caller falls back to the default formatter.
 */
export function formatNumberCell(
  value: unknown,
  type: string,
  fmt: ColumnFormat["number"] | undefined,
): { text: string; negative: boolean; red: boolean } | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !fmt) return null;
  const style =
    !fmt.style || fmt.style === "auto"
      ? type === "currency"
        ? "currency"
        : type === "percent"
          ? "percent"
          : "number"
      : fmt.style;
  const scaled = style === "percent" && fmt.percentInput === "fraction" ? value * 100 : value;
  const decimals =
    fmt.decimals ??
    (style === "currency" ? (Math.abs(scaled) >= 1000 ? 0 : 2) : style === "percent" ? 1 : 2);
  const abs = Math.abs(scaled);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: fmt.decimals ?? 0,
    maximumFractionDigits: decimals,
    useGrouping: style === "plain" ? false : fmt.thousands !== false,
  });
  const core = style === "currency" ? `$${body}` : style === "percent" ? `${body}%` : body;
  const negative = scaled < 0 && Number(abs.toFixed(decimals)) !== 0;
  const neg = fmt.negative ?? "minus";
  const signed = !negative
    ? core
    : neg === "parens" || neg === "red_parens"
      ? `(${core})`
      : `-${core}`;
  return {
    text: `${fmt.prefix ?? ""}${signed}${fmt.suffix ?? ""}`,
    negative,
    red: negative && (neg === "red" || neg === "red_parens"),
  };
}

/** The first matching cell rule's style, evaluated on raw values (never formatted text). */
export function cellRuleStyle(
  format: ColumnFormat | undefined,
  readRaw: (columnId: string | undefined) => unknown,
): ConditionalRule["style"] | null {
  for (const rule of format?.rules ?? [])
    if (ruleMatches(rule as unknown as ConditionalRule, readRaw(rule.column))) return rule.style;
  return null;
}
