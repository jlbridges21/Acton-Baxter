"use client";

/**
 * The report's theme for its widgets. Every helper returns today's classes when the report
 * has no theme and the widget has no appearance, so unstyled reports look exactly as before.
 */

import { createContext, useContext } from "react";
import type { CSSProperties } from "react";
import {
  categoryColor,
  resolveColor,
  resolvePalette,
  resolveTokens,
  type ReportTheme,
} from "@/lib/reports/style";
import type { WidgetSpec } from "@/lib/reports/spec";

export const ReportThemeContext = createContext<ReportTheme | null>(null);

export function useReportTheme(): ReportTheme | null {
  return useContext(ReportThemeContext);
}

type Appearance = {
  card?: string;
  typography?: string;
  density?: string;
  titleAlign?: string;
  hideTitle?: boolean;
  palette?: string;
};

export function appearanceOf(w: WidgetSpec): Appearance | undefined {
  return (w as { appearance?: Appearance }).appearance;
}

/** Whether colors should be bound to values (stable) instead of positions (legacy look). */
export function styled(theme: ReportTheme | null, w: WidgetSpec): boolean {
  return Boolean(theme) || Boolean(appearanceOf(w));
}

/** Card classes: the existing card unless a card style is chosen. */
export function cardClasses(theme: ReportTheme | null, w: WidgetSpec): string {
  const card = appearanceOf(w)?.card ?? theme?.card ?? "default";
  const density = appearanceOf(w)?.density ?? theme?.density ?? "default";
  const pad = density === "compact" ? "p-3" : density === "comfortable" ? "p-5" : "p-4";
  if (card === "flat") return `rounded-lg ${pad}`;
  if (card === "outlined") return `rounded-lg border border-[var(--acton-border)] bg-white ${pad}`;
  if (card === "elevated")
    return `rounded-lg border border-[var(--acton-border)] bg-white ${pad} shadow-md`;
  return `rounded-lg border border-[var(--acton-border)] bg-white ${pad} shadow-sm`;
}

/** Inline colors from report tokens (only the tokens a theme actually overrides). */
export function surfaceStyle(theme: ReportTheme | null): CSSProperties | undefined {
  if (!theme?.tokens) return undefined;
  const t = resolveTokens(theme);
  return {
    ...(theme.tokens.surface ? { backgroundColor: t.surface } : {}),
    ...(theme.tokens.border ? { borderColor: t.border } : {}),
    ...(theme.tokens.text ? { color: t.text } : {}),
  };
}

export function gridGap(theme: ReportTheme | null): string {
  return theme?.spacing === "tight" ? "gap-2" : theme?.spacing === "loose" ? "gap-6" : "gap-4";
}

export function titleClass(theme: ReportTheme | null, w: WidgetSpec): string {
  const scale = appearanceOf(w)?.typography ?? theme?.typography ?? "md";
  return scale === "sm" ? "text-xs" : scale === "lg" ? "text-base" : "text-sm";
}

export function kpiValueClass(theme: ReportTheme | null, w: WidgetSpec): string {
  const scale = appearanceOf(w)?.typography ?? theme?.typography ?? "md";
  return scale === "sm" ? "text-2xl" : scale === "lg" ? "text-4xl" : "text-3xl";
}

export function color(theme: ReportTheme | null, c: string | undefined | null, fallback?: string) {
  return resolveColor(c, resolveTokens(theme), fallback);
}

/** Palette for a widget (widget override → report palette → default). */
export function paletteFor(theme: ReportTheme | null, w: WidgetSpec): string[] {
  return resolvePalette(theme, appearanceOf(w)?.palette ?? null);
}

/** Stable color for a category/series value of a widget (bound by value, not position). */
export function valueColor(
  theme: ReportTheme | null,
  w: WidgetSpec,
  value: string,
  field: string | null | undefined,
  widgetColors?: Record<string, string>,
): string {
  return categoryColor(value, {
    theme,
    field: field ?? null,
    widget: widgetColors ?? null,
    palette: paletteFor(theme, w),
  });
}

type TableLook = {
  header?: string;
  density?: string;
  zebra?: boolean;
  dividers?: string;
  groupHeader?: string;
  subtotal?: string;
  columns?: Record<string, { align?: string }>;
  controls?: {
    search?: boolean;
    columns?: boolean;
    expandAll?: boolean;
    collapseAll?: boolean;
    expandToLevel?: boolean;
  };
};

/** Table classes; every default equals today's table. */
export function tableLook(theme: ReportTheme | null, w: WidgetSpec) {
  const look = (appearanceOf(w) ?? {}) as TableLook;
  const density = look.density ?? theme?.density ?? "default";
  const tokens = resolveTokens(theme);
  return {
    head:
      look.header === "bold"
        ? "bg-[var(--acton-gray-50)] text-left text-xs font-bold text-[var(--acton-navy)]"
        : look.header === "muted"
          ? "bg-white text-left text-xs text-[var(--acton-muted)]"
          : "bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]",
    headStyle:
      look.header === "accent" ? { backgroundColor: tokens.accent, color: "#ffffff" } : undefined,
    cell:
      density === "compact" ? "px-2 py-1" : density === "comfortable" ? "px-4 py-3" : "px-3 py-2",
    row: look.dividers === "none" ? "" : "border-t border-[var(--acton-gray-100)]",
    cellBorder:
      look.dividers === "grid" ? "border-l border-[var(--acton-gray-100)] first:border-l-0" : "",
    zebra: Boolean(look.zebra),
    groupHeader: look.groupHeader ?? "default",
    subtotalBold: look.subtotal === "bold",
    align: (ref?: string) => (ref ? look.columns?.[ref]?.align : undefined),
    show: {
      search: look.controls?.search !== false,
      columns: look.controls?.columns !== false,
      expandAll: look.controls?.expandAll !== false,
      collapseAll: look.controls?.collapseAll !== false,
      expandToLevel: look.controls?.expandToLevel !== false,
    },
  };
}

/** Inline row colors from a server-evaluated appearance rule. */
export function ruleRowStyle(
  theme: ReportTheme | null,
  s: { color?: string; background?: string; accent?: string; emphasis?: string } | undefined,
): CSSProperties | undefined {
  if (!s) return undefined;
  return {
    ...(s.color ? { color: color(theme, s.color) } : {}),
    ...(s.background ? { backgroundColor: color(theme, s.background) } : {}),
    ...(s.accent ? { boxShadow: `inset 4px 0 0 ${color(theme, s.accent)}` } : {}),
    ...(s.emphasis === "bold"
      ? { fontWeight: 700 }
      : s.emphasis === "muted"
        ? { opacity: 0.6 }
        : {}),
  };
}
