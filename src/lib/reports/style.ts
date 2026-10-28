/**
 * Report styling: optional, validated presentation settings in the report spec (report
 * `theme`, widget `appearance`).
 *
 * Styling is configuration only — named palettes, design tokens, normalized hex colors, and
 * small enums. No CSS, HTML, scripts, or URLs are accepted anywhere, and nothing here can
 * change data access, calculations, or query results. A report without `theme` and widgets
 * without `appearance` render exactly as before.
 *
 * Colors are either a design token ("token:accent") or a 6-digit hex ("#1f6feb"; "#abc" is
 * expanded). Transparent/alpha colors are rejected so text stays readable.
 *
 * Stable color binding: when a report has a theme or a widget has an appearance, category colors
 * come from explicit bindings first (widget, then report-wide by field), then a deterministic
 * hash of the value into the palette — so a value keeps its color across filters, sorting,
 * and pages. Blank values use the null color.
 */

import { z } from "zod";

// ── Palettes and tokens ─────────────────────────────────────────────────────────────────

/** The chart palette the renderer has always used (validated reference palette). */
export const DEFAULT_CATEGORICAL = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

export const TOKEN_NAMES = [
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "accent",
  "positive",
  "warning",
  "negative",
  "info",
  "neutral",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

/** Current app defaults (globals.css: --acton-* tokens and the status hues already in use). */
export const DEFAULT_TOKENS: Record<TokenName, string> = {
  background: "#f5f7fa",
  surface: "#ffffff",
  text: "#0b1f3a",
  muted: "#5b6b7c",
  border: "#d7dee8",
  accent: "#2a78d6",
  positive: "#1baf7a",
  warning: "#eda100",
  negative: "#e34948",
  info: "#2a78d6",
  neutral: "#a3acb8",
};

type Palette = {
  label: string;
  description: string;
  categorical: string[];
  sequential: [string, string];
  tokens?: Partial<Record<TokenName, string>>;
};

/**
 * Named palettes. "acton" uses only the brand tokens defined in the app (navy #0b1f3a,
 * yellow #f5c518, grays) followed by the default palette — no other brand colors are assumed.
 * Add palettes here; the renderer, editor, and Dexter read this list.
 */
export const PALETTES: Record<string, Palette> = {
  default: {
    label: "Default",
    description: "Baxter's standard chart palette.",
    categorical: DEFAULT_CATEGORICAL,
    sequential: ["#d6e6f8", "#2a78d6"],
  },
  acton: {
    label: "Acton ADU",
    description:
      "Acton brand navy and yellow (from the app's design tokens), then the default hues.",
    categorical: [
      "#0b1f3a",
      "#e0b100",
      "#5b6b7c",
      "#2a78d6",
      "#1baf7a",
      "#eb6834",
      "#6250d6",
      "#e34948",
    ],
    sequential: ["#e8edf3", "#0b1f3a"],
    tokens: { accent: "#0b1f3a" },
  },
  slate: {
    label: "Slate",
    description: "Muted blues and grays for dense dashboards.",
    categorical: [
      "#334155",
      "#64748b",
      "#0e7490",
      "#4d7c0f",
      "#a16207",
      "#9f1239",
      "#6d28d9",
      "#94a3b8",
    ],
    sequential: ["#e2e8f0", "#334155"],
  },
  high_contrast: {
    label: "High contrast",
    description: "Strongly separated hues for projection and accessibility.",
    categorical: [
      "#000000",
      "#e69f00",
      "#0072b2",
      "#009e73",
      "#d55e00",
      "#cc79a7",
      "#56b4e9",
      "#f0e442",
    ],
    sequential: ["#ffffff", "#000000"],
  },
};
export const PALETTE_NAMES = Object.keys(PALETTES) as [string, ...string[]];

// ── Schemas ─────────────────────────────────────────────────────────────────────────────

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

export const colorSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .transform((v) => (HEX3.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v))
  .refine((v) => HEX6.test(v) || TOKEN_NAMES.some((t) => v === `token:${t}`), {
    message: `Use a 6-digit hex color like "#1f6feb" or a token: ${TOKEN_NAMES.map((t) => `token:${t}`).join(", ")}. Transparent colors, names, and CSS aren't allowed.`,
  });
export type Color = z.infer<typeof colorSchema>;

const paletteName = z.enum(PALETTE_NAMES, {
  message: `Palette must be one of: ${PALETTE_NAMES.join(", ")}.`,
});
export const TYPE_SCALES = ["sm", "md", "lg"] as const;
export const DENSITIES = ["compact", "default", "comfortable"] as const;
export const SPACINGS = ["tight", "default", "loose"] as const;
export const CARD_STYLES = ["default", "flat", "outlined", "elevated"] as const;
export const LEGEND_POSITIONS = ["top", "bottom", "left", "right", "none"] as const;

/** A category value (as shown in charts and group rows) → color. "(blank)" is the blank bucket. */
const valueColors = z
  .record(z.string().trim().min(1).max(200), colorSchema)
  .refine((r) => Object.keys(r).length <= 60, { message: "At most 60 value colors." });

const fieldRefPattern =
  /^(job\.[a-zA-Z]+|model\.[a-zA-Z]+|item\.[a-zA-Z]+|com\.[a-zA-Z]+|cf:[A-Za-z0-9]{6,40}|sem:[a-z0-9_]{2,60}|calc:[a-z][a-z0-9_]{1,40})$/;
const styleFieldRef = z.string().trim().regex(fieldRefPattern, "Unknown field reference format.");

export const RULE_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "blank",
  "not_blank",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
] as const;

const ruleValue = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(50),
]);

export const ruleStyleSchema = z
  .object({
    color: colorSchema.optional(),
    background: colorSchema.optional(),
    accent: colorSchema.optional(),
    emphasis: z.enum(["normal", "bold", "muted"]).optional(),
  })
  .strict()
  .refine((s) => Object.keys(s).length > 0, { message: "A rule needs at least one style." });

/**
 * Conditional style rule. Rules are evaluated in order and the first match wins.
 * `field` is required for table rows; for KPIs it defaults to the KPI value and for charts to
 * each point's value ("target": "category" compares the category label instead).
 */
export const conditionalRuleSchema = z
  .object({
    field: styleFieldRef.optional(),
    target: z.enum(["value", "category"]).optional(),
    op: z.enum(RULE_OPS),
    value: ruleValue.optional(),
    style: ruleStyleSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.op === "between" && !(Array.isArray(r.value) && r.value.length === 2))
      ctx.addIssue({ code: "custom", path: ["value"], message: '"between" needs [low, high].' });
    if (["in", "not_in"].includes(r.op) && !Array.isArray(r.value))
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `"${r.op}" needs a list of values.`,
      });
    if (!["blank", "not_blank", "between", "in", "not_in"].includes(r.op) && r.value === undefined)
      ctx.addIssue({ code: "custom", path: ["value"], message: `"${r.op}" needs a value.` });
  });
export type ConditionalRule = z.infer<typeof conditionalRuleSchema>;

const rules = z.array(conditionalRuleSchema).max(12);

export const themeSchema = z
  .object({
    palette: paletteName.optional(),
    /** Override design tokens for this report. */
    tokens: z.partialRecord(z.enum(TOKEN_NAMES), colorSchema).optional(),
    chart: z
      .object({
        categorical: z.array(colorSchema).min(2).max(12).optional(),
        sequential: z.tuple([colorSchema, colorSchema]).optional(),
      })
      .strict()
      .optional(),
    typography: z.enum(TYPE_SCALES).optional(),
    density: z.enum(DENSITIES).optional(),
    spacing: z.enum(SPACINGS).optional(),
    card: z.enum(CARD_STYLES).optional(),
    /** Report-wide category colors by field (e.g. the same Phase colors in every chart). */
    categoryColors: z
      .record(styleFieldRef, valueColors)
      .refine((r) => Object.keys(r).length <= 12, { message: "At most 12 fields." })
      .optional(),
    /** Color for blank/unknown category values. */
    nullColor: colorSchema.optional(),
    /** Optional status colors by value (e.g. "Blocked" → token:negative), applied to any field. */
    statusColors: valueColors.optional(),
  })
  .strict();
export type ReportTheme = z.infer<typeof themeSchema>;

const presentation = {
  card: z.enum(CARD_STYLES).optional(),
  typography: z.enum(TYPE_SCALES).optional(),
  density: z.enum(DENSITIES).optional(),
  titleAlign: z.enum(["left", "center"]).optional(),
  hideTitle: z.boolean().optional(),
};

export const kpiStyleSchema = z
  .object({
    ...presentation,
    accent: colorSchema.optional(),
    background: colorSchema.optional(),
    valueColor: colorSchema.optional(),
    align: z.enum(["left", "center"]).optional(),
    rules: rules.optional(),
  })
  .strict();

const axisSchema = z
  .object({ show: z.boolean().optional(), label: z.string().trim().max(60).optional() })
  .strict();

export const chartStyleSchema = z
  .object({
    ...presentation,
    palette: paletteName.optional(),
    /** Series key (seriesBy value or metric) → color. */
    seriesColors: valueColors.optional(),
    /** Category value → color for this chart (overrides report-wide bindings). */
    categoryColors: valueColors.optional(),
    legend: z
      .object({ show: z.boolean().optional(), position: z.enum(LEGEND_POSITIONS).optional() })
      .strict()
      .optional(),
    axis: z
      .object({ x: axisSchema.optional(), y: axisSchema.optional(), grid: z.boolean().optional() })
      .strict()
      .optional(),
    rules: rules.optional(),
  })
  .strict();

export const tableStyleSchema = z
  .object({
    ...presentation,
    header: z.enum(["default", "muted", "bold", "accent"]).optional(),
    zebra: z.boolean().optional(),
    dividers: z.enum(["rows", "none", "grid"]).optional(),
    groupHeader: z.enum(["default", "emphasized", "subtle"]).optional(),
    subtotal: z.enum(["default", "bold"]).optional(),
    rules: rules.optional(),
    columns: z
      .record(
        styleFieldRef,
        z.object({ align: z.enum(["left", "center", "right"]).optional() }).strict(),
      )
      .optional(),
    controls: z
      .object({
        search: z.boolean().optional(),
        columns: z.boolean().optional(),
        expandAll: z.boolean().optional(),
        collapseAll: z.boolean().optional(),
        expandToLevel: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const basicStyleSchema = z.object(presentation).strict();

export type KpiStyle = z.infer<typeof kpiStyleSchema>;
export type ChartStyle = z.infer<typeof chartStyleSchema>;
export type TableStyle = z.infer<typeof tableStyleSchema>;

// ── Resolution (shared by renderer, editor previews, and validation) ────────────────────

export function resolveTokens(theme?: ReportTheme | null): Record<TokenName, string> {
  const palette = theme?.palette ? PALETTES[theme.palette] : undefined;
  return { ...DEFAULT_TOKENS, ...(palette?.tokens ?? {}), ...(theme?.tokens ?? {}) } as Record<
    TokenName,
    string
  >;
}

/** A color (token or hex) as hex; unknown values fall back. */
export function resolveColor(
  c: string | null | undefined,
  tokens: Record<TokenName, string>,
  fallback = DEFAULT_TOKENS.text,
): string {
  if (!c) return fallback;
  if (c.startsWith("token:")) return tokens[c.slice(6) as TokenName] ?? fallback;
  return HEX6.test(c) ? c : fallback;
}

export function resolvePalette(
  theme?: ReportTheme | null,
  widgetPalette?: string | null,
): string[] {
  if (widgetPalette && PALETTES[widgetPalette]) return PALETTES[widgetPalette]!.categorical;
  if (theme?.chart?.categorical?.length) {
    const tokens = resolveTokens(theme);
    return theme.chart.categorical.map((c) => resolveColor(c, tokens));
  }
  if (theme?.palette && PALETTES[theme.palette]) return PALETTES[theme.palette]!.categorical;
  return DEFAULT_CATEGORICAL;
}

/** FNV-1a: a stable index for a category value (independent of order or filters). */
export function stableIndex(value: string, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return size ? h % size : 0;
}

export const BLANK_CATEGORY = "(blank)";

/**
 * Deterministic color for a category value: widget binding → report binding for the field →
 * report status colors → blank/null color → stable hash into the palette.
 */
export function categoryColor(
  value: string,
  opts: {
    theme?: ReportTheme | null;
    field?: string | null;
    widget?: Record<string, string> | null;
    palette: string[];
  },
): string {
  const tokens = resolveTokens(opts.theme);
  const bound =
    opts.widget?.[value] ??
    (opts.field ? opts.theme?.categoryColors?.[opts.field]?.[value] : undefined) ??
    opts.theme?.statusColors?.[value];
  if (bound) return resolveColor(bound, tokens);
  if (value === BLANK_CATEGORY || value === "")
    return resolveColor(opts.theme?.nullColor ?? "token:neutral", tokens);
  return opts.palette[stableIndex(value, opts.palette.length)]!;
}

const num = (v: unknown) =>
  typeof v === "number"
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
const blank = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : blank(v) ? [] : [String(v)];

/** Whether one rule matches a value (same semantics as report filters, plus "between"). */
export function ruleMatches(rule: ConditionalRule, value: unknown): boolean {
  const r = rule.value;
  switch (rule.op) {
    case "blank":
      return blank(value);
    case "not_blank":
      return !blank(value);
    case "eq":
      return (
        list(value).some((v) => v.toLowerCase() === String(r).toLowerCase()) ||
        (num(value) === num(r) && num(r) !== null)
      );
    case "neq":
      return !list(value).some((v) => v.toLowerCase() === String(r).toLowerCase());
    case "in":
      return list(value).some((v) =>
        (r as unknown[]).map((x) => String(x).toLowerCase()).includes(v.toLowerCase()),
      );
    case "not_in":
      return !list(value).some((v) =>
        (r as unknown[]).map((x) => String(x).toLowerCase()).includes(v.toLowerCase()),
      );
    case "contains":
      return list(value).some((v) => v.toLowerCase().includes(String(r).toLowerCase()));
    case "between": {
      const [lo, hi] = (r as unknown[]).map(num);
      const n = num(value);
      return n !== null && lo != null && hi != null && n >= lo && n <= hi;
    }
    default: {
      const n = num(value);
      const t = num(r);
      if (n === null || t === null) return false;
      return rule.op === "gt"
        ? n > t
        : rule.op === "gte"
          ? n >= t
          : rule.op === "lt"
            ? n < t
            : n <= t;
    }
  }
}

/** First matching rule's style (deterministic precedence: order in the list). */
export function firstRuleStyle(
  ruleList: ConditionalRule[] | undefined,
  read: (rule: ConditionalRule) => unknown,
): ConditionalRule["style"] | null {
  for (const rule of ruleList ?? []) if (ruleMatches(rule, read(rule))) return rule.style;
  return null;
}

// ── Accessibility ───────────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/** Readability warnings (text on its background below WCAG AA 4.5:1). Not errors. */
export function styleWarnings(spec: {
  theme?: ReportTheme | null;
  widgets: Array<{ id: string; type: string; appearance?: unknown }>;
}): string[] {
  const tokens = resolveTokens(spec.theme);
  const out: string[] = [];
  const check = (where: string, fg?: string | null, bg?: string | null) => {
    if (!fg && !bg) return;
    const f = resolveColor(fg ?? "token:text", tokens);
    const b = resolveColor(bg ?? "token:surface", tokens);
    const ratio = contrastRatio(f, b);
    if (ratio < 4.5)
      out.push(`${where}: text contrast ${ratio}:1 is below 4.5:1 and may be hard to read.`);
  };
  check("theme", spec.theme?.tokens?.text, spec.theme?.tokens?.surface);
  for (const w of spec.widgets) {
    const s = (w.appearance ?? {}) as KpiStyle & TableStyle;
    if (w.type === "kpi") check(`widget ${w.id}`, s.valueColor, s.background);
    (s.rules ?? []).forEach((r, i) => {
      if (r.style.color || r.style.background)
        check(`widget ${w.id} rule ${i + 1}`, r.style.color, r.style.background ?? s.background);
    });
  }
  return out;
}
