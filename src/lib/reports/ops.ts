/**
 * Structured report edits. Dexter edits existing reports with these operations instead of
 * rewriting the whole spec, so unrelated widgets, filters, and data bindings are preserved.
 * The result is re-validated as a full spec before it is saved.
 */

import { z } from "zod";
import {
  basicStyleSchema,
  chartStyleSchema,
  kpiStyleSchema,
  tableStyleSchema,
  themeSchema,
} from "./style";
import {
  calcKey,
  calculationSchema,
  conditionSchema,
  relationshipKey,
  relationshipSchema,
  controlSchema,
  datasetSchema,
  parseReportSpec,
  widgetSchema,
  type ReportSpec,
  type SpecIssue,
} from "./spec";

const widgetId = z.string().min(1).max(40);

export const reportOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_title"), title: z.string().trim().min(1).max(160) }),
  z.object({ op: z.literal("set_description"), description: z.string().max(1000) }),
  z.object({
    op: z.literal("add_widget"),
    widget: z.unknown(),
    position: z
      .enum(["top", "bottom"])
      .or(z.object({ after: widgetId }))
      .or(z.object({ before: widgetId }))
      .default("bottom"),
  }),
  /** Shallow merge into an existing widget (keeps its id and type). */
  z.object({
    op: z.literal("update_widget"),
    id: widgetId,
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal("remove_widget"), id: widgetId }),
  z.object({
    op: z.literal("move_widget"),
    id: widgetId,
    to: z
      .enum(["top", "bottom"])
      .or(z.object({ after: widgetId }))
      .or(z.object({ before: widgetId })),
  }),
  z.object({ op: z.literal("reorder_widgets"), order: z.array(widgetId).min(1).max(40) }),
  z.object({ op: z.literal("add_dataset"), dataset: datasetSchema }),
  z.object({
    op: z.literal("set_dataset_filters"),
    id: widgetId,
    filters: z.array(conditionSchema).max(20),
  }),
  z.object({ op: z.literal("add_control"), control: controlSchema }),
  z.object({
    op: z.literal("update_control"),
    id: widgetId,
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal("remove_control"), id: widgetId }),
  /** Add or replace a report-specific calculated field (calc:<key>). */
  z.object({ op: z.literal("set_calculation"), calculation: calculationSchema }),
  z.object({ op: z.literal("remove_calculation"), key: calcKey }),
  /** Add or replace a report-specific relationship (validated stable-id join). */
  z.object({ op: z.literal("set_relationship"), relationship: relationshipSchema }),
  z.object({ op: z.literal("remove_relationship"), id: relationshipKey }),
  /** Report-wide styling (palette, tokens, density, typography, category colors…). */
  z.object({
    op: z.literal("set_theme"),
    theme: themeSchema,
    /** Merge into the current theme (default) or replace it. */
    mode: z.enum(["merge", "replace"]).default("merge"),
  }),
  z.object({ op: z.literal("remove_theme") }),
  /** Widget presentation (colors, legend, rules, table look, grouped-table buttons…). */
  z.object({
    op: z.literal("set_widget_appearance"),
    id: widgetId,
    appearance: z.record(z.string(), z.unknown()),
    mode: z.enum(["merge", "replace"]).default("merge"),
  }),
  z.object({ op: z.literal("remove_widget_appearance"), id: widgetId }),
]);
export type ReportOp = z.infer<typeof reportOpSchema>;

type Position = "top" | "bottom" | { after: string } | { before: string };

function insertAt<T extends { id: string }>(list: T[], item: T, pos: Position): T[] {
  const out = list.filter((x) => x.id !== item.id);
  if (pos === "top") return [item, ...out];
  if (pos === "bottom") return [...out, item];
  const anchorId = "after" in pos ? pos.after : pos.before;
  const idx = out.findIndex((x) => x.id === anchorId);
  if (idx < 0) return [...out, item];
  out.splice("after" in pos ? idx + 1 : idx, 0, item);
  return out;
}

export type ApplyResult =
  { ok: true; spec: ReportSpec; summary: string[] } | { ok: false; issues: SpecIssue[] };

export function applyReportOps(current: ReportSpec, rawOps: unknown[]): ApplyResult {
  const issues: SpecIssue[] = [];
  const ops: ReportOp[] = [];
  rawOps.forEach((raw, i) => {
    const parsed = reportOpSchema.safeParse(raw);
    if (parsed.success) ops.push(parsed.data);
    else
      issues.push(
        ...parsed.error.issues.slice(0, 5).map((issue) => ({
          path: [`operations[${i}]`, ...issue.path.map(String)].join("."),
          message: issue.message,
        })),
      );
  });
  if (issues.length) return { ok: false, issues };

  // Work on a plain copy; validation happens once at the end.
  type LooseWidget = Record<string, unknown> & { id: string; type: string };
  const draft = structuredClone(current) as unknown as Omit<ReportSpec, "widgets"> & {
    widgets: LooseWidget[];
  };
  const summary: string[] = [];
  const widgetTitle = (id: string) =>
    (draft.widgets.find((w) => w.id === id)?.title as string) || id;

  for (const [i, op] of ops.entries()) {
    const need = (exists: boolean, what: string) => {
      if (!exists) issues.push({ path: `operations[${i}]`, message: `${what} doesn't exist.` });
      return exists;
    };
    switch (op.op) {
      case "set_title":
        draft.title = op.title;
        summary.push(`Renamed the report to "${op.title}"`);
        break;
      case "set_description":
        draft.description = op.description;
        summary.push("Updated the description");
        break;
      case "add_widget": {
        const parsed = widgetSchema.safeParse(op.widget);
        if (!parsed.success) {
          issues.push({
            path: `operations[${i}].widget`,
            message: parsed.error.issues[0]?.message ?? "Invalid widget",
          });
          break;
        }
        if (draft.widgets.some((w) => w.id === parsed.data.id)) {
          issues.push({
            path: `operations[${i}]`,
            message: `Widget id "${parsed.data.id}" is already used.`,
          });
          break;
        }
        draft.widgets = insertAt(
          draft.widgets,
          parsed.data as unknown as LooseWidget,
          op.position as Position,
        );
        summary.push(`Added "${parsed.data.title || parsed.data.id}"`);
        break;
      }
      case "update_widget": {
        const idx = draft.widgets.findIndex((w) => w.id === op.id);
        if (!need(idx >= 0, `Widget "${op.id}"`)) break;
        const { id: _ignoredId, ...changes } = op.changes;
        void _ignoredId;
        const merged = { ...draft.widgets[idx]!, ...changes, id: op.id };
        const parsed = widgetSchema.safeParse(merged);
        if (!parsed.success) {
          issues.push({
            path: `operations[${i}].changes`,
            message: `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`,
          });
          break;
        }
        draft.widgets[idx] = parsed.data as unknown as LooseWidget;
        summary.push(`Updated "${widgetTitle(op.id)}" (${Object.keys(changes).join(", ")})`);
        break;
      }
      case "remove_widget":
        if (
          !need(
            draft.widgets.some((w) => w.id === op.id),
            `Widget "${op.id}"`,
          )
        )
          break;
        summary.push(`Removed "${widgetTitle(op.id)}"`);
        draft.widgets = draft.widgets.filter((w) => w.id !== op.id);
        break;
      case "move_widget": {
        const w = draft.widgets.find((x) => x.id === op.id);
        if (!need(Boolean(w), `Widget "${op.id}"`)) break;
        draft.widgets = insertAt(draft.widgets, w!, op.to as Position);
        summary.push(`Moved "${widgetTitle(op.id)}"`);
        break;
      }
      case "reorder_widgets": {
        const byId = new Map(draft.widgets.map((w) => [w.id, w]));
        const ordered = op.order.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
        const rest = draft.widgets.filter((w) => !op.order.includes(w.id));
        draft.widgets = [...ordered, ...rest];
        summary.push("Reordered widgets");
        break;
      }
      case "add_dataset":
        if (draft.datasets.some((d) => d.id === op.dataset.id)) {
          issues.push({
            path: `operations[${i}]`,
            message: `Dataset "${op.dataset.id}" already exists.`,
          });
          break;
        }
        draft.datasets.push(op.dataset);
        summary.push(`Added dataset "${op.dataset.label ?? op.dataset.id}"`);
        break;
      case "set_dataset_filters": {
        const ds = draft.datasets.find((d) => d.id === op.id);
        if (!need(Boolean(ds), `Dataset "${op.id}"`)) break;
        ds!.filters = op.filters;
        summary.push(`Changed filters on "${ds!.label ?? ds!.id}"`);
        break;
      }
      case "add_control":
        if (draft.controls.some((c) => c.id === op.control.id)) {
          issues.push({
            path: `operations[${i}]`,
            message: `Filter "${op.control.id}" already exists.`,
          });
          break;
        }
        draft.controls.push(op.control);
        summary.push(`Added filter "${op.control.label}"`);
        break;
      case "update_control": {
        const idx = draft.controls.findIndex((c) => c.id === op.id);
        if (!need(idx >= 0, `Filter "${op.id}"`)) break;
        const parsed = controlSchema.safeParse({
          ...draft.controls[idx],
          ...op.changes,
          id: op.id,
        });
        if (!parsed.success) {
          issues.push({
            path: `operations[${i}]`,
            message: parsed.error.issues[0]?.message ?? "Invalid filter",
          });
          break;
        }
        draft.controls[idx] = parsed.data;
        summary.push(`Updated filter "${parsed.data.label}"`);
        break;
      }
      case "remove_control":
        if (
          !need(
            draft.controls.some((c) => c.id === op.id),
            `Filter "${op.id}"`,
          )
        )
          break;
        draft.controls = draft.controls.filter((c) => c.id !== op.id);
        summary.push(`Removed filter "${op.id}"`);
        break;
      case "set_calculation": {
        const idx = draft.calculations.findIndex((c) => c.key === op.calculation.key);
        if (idx >= 0) draft.calculations[idx] = op.calculation;
        else draft.calculations.push(op.calculation);
        summary.push(
          `${idx >= 0 ? "Updated" : "Added"} calculation "${op.calculation.label}" (calc:${op.calculation.key})`,
        );
        break;
      }
      case "set_theme": {
        const merged =
          op.mode === "replace" || !draft.theme ? op.theme : { ...draft.theme, ...op.theme };
        const parsed = themeSchema.safeParse(merged);
        if (!parsed.success) {
          issues.push(
            ...parsed.error.issues.slice(0, 5).map((issue) => ({
              path: [`operations[${i}].theme`, ...issue.path.map(String)].join("."),
              message: issue.message,
            })),
          );
          break;
        }
        draft.theme = parsed.data;
        summary.push("Updated the report style");
        break;
      }
      case "remove_theme":
        delete draft.theme;
        summary.push("Removed the report style (default look)");
        break;
      case "set_widget_appearance":
      case "remove_widget_appearance": {
        const idx = draft.widgets.findIndex((w) => w.id === op.id);
        if (!need(idx >= 0, `Widget "${op.id}"`)) break;
        const current = draft.widgets[idx]!;
        const next: LooseWidget = { ...current };
        if (op.op === "remove_widget_appearance") delete next.appearance;
        else
          next.appearance =
            op.mode === "replace"
              ? op.appearance
              : { ...((current.appearance as Record<string, unknown>) ?? {}), ...op.appearance };
        const parsed = widgetSchema.safeParse(next);
        if (!parsed.success) {
          issues.push(
            ...parsed.error.issues.slice(0, 5).map((issue) => ({
              path: [`operations[${i}]`, `widget ${op.id}`, ...issue.path.map(String)].join("."),
              message:
                issue.code === "unrecognized_keys"
                  ? `${issue.message}. ${current.type} widgets support: ${allowedAppearanceKeys(current.type)}.`
                  : issue.message,
            })),
          );
          break;
        }
        draft.widgets[idx] = parsed.data as unknown as LooseWidget;
        summary.push(
          `${op.op === "remove_widget_appearance" ? "Reset the look of" : "Styled"} "${widgetTitle(op.id)}"`,
        );
        break;
      }
      case "set_relationship": {
        const idx = draft.relationships.findIndex((r) => r.id === op.relationship.id);
        if (idx >= 0) draft.relationships[idx] = op.relationship;
        else draft.relationships.push(op.relationship);
        summary.push(
          `${idx >= 0 ? "Updated" : "Added"} relationship "${op.relationship.label}" (${op.relationship.id})`,
        );
        break;
      }
      case "remove_relationship": {
        if (
          !need(
            draft.relationships.some((r) => r.id === op.id),
            `Relationship "${op.id}"`,
          )
        )
          break;
        if (draft.calculations.some((c) => c.rollup?.relationship === op.id)) {
          issues.push({
            path: `operations[${i}]`,
            message: `Relationship "${op.id}" is used by a rollup calculation; remove that first.`,
          });
          break;
        }
        draft.relationships = draft.relationships.filter((r) => r.id !== op.id);
        summary.push(`Removed relationship ${op.id}`);
        break;
      }
      case "remove_calculation": {
        if (
          !need(
            draft.calculations.some((c) => c.key === op.key),
            `Calculation "${op.key}"`,
          )
        )
          break;
        const ref = new RegExp(`calc:${op.key}(?![a-z0-9_])`);
        const { calculations, ...rest } = draft;
        if (
          ref.test(
            JSON.stringify({ ...rest, calculations: calculations.filter((c) => c.key !== op.key) }),
          )
        ) {
          issues.push({
            path: `operations[${i}]`,
            message: `calc:${op.key} is still used in this report; remove those uses first.`,
          });
          break;
        }
        draft.calculations = calculations.filter((c) => c.key !== op.key);
        summary.push(`Removed calculation calc:${op.key}`);
        break;
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  const validated = parseReportSpec(draft);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  return { ok: true, spec: validated.spec, summary };
}

/** Appearance keys a widget type supports (for helpful validation messages). */
export function allowedAppearanceKeys(type: string): string {
  const shape =
    type === "kpi"
      ? kpiStyleSchema.shape
      : type === "chart"
        ? chartStyleSchema.shape
        : type === "table"
          ? tableStyleSchema.shape
          : basicStyleSchema.shape;
  return Object.keys(shape).join(", ");
}

/** Human summary of what changed between two specs (for revision history). */
export function diffSpecs(before: ReportSpec, after: ReportSpec): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: "${before.title}" → "${after.title}"`);
  const b = new Map(before.widgets.map((w) => [w.id, w]));
  const a = new Map(after.widgets.map((w) => [w.id, w]));
  for (const [id, w] of a) if (!b.has(id)) out.push(`Added ${w.type} "${w.title || id}"`);
  for (const [id, w] of b) if (!a.has(id)) out.push(`Removed ${w.type} "${w.title || id}"`);
  for (const [id, w] of a) {
    const prev = b.get(id);
    if (prev && JSON.stringify(prev) !== JSON.stringify(w))
      out.push(`Changed ${w.type} "${w.title || id}"`);
  }
  const orderBefore = before.widgets
    .map((w) => w.id)
    .filter((id) => a.has(id))
    .join(",");
  const orderAfter = after.widgets
    .map((w) => w.id)
    .filter((id) => b.has(id))
    .join(",");
  if (orderBefore !== orderAfter) out.push("Rearranged the layout");
  if (JSON.stringify(before.datasets) !== JSON.stringify(after.datasets))
    out.push("Changed data filters");
  if (JSON.stringify(before.controls) !== JSON.stringify(after.controls))
    out.push("Changed report filters");
  if (JSON.stringify(before.calculations ?? []) !== JSON.stringify(after.calculations ?? []))
    out.push("Changed calculations");
  if (JSON.stringify(before.relationships ?? []) !== JSON.stringify(after.relationships ?? []))
    out.push("Changed relationships");
  if (JSON.stringify(before.theme ?? null) !== JSON.stringify(after.theme ?? null))
    out.push("Changed the report style");
  return out;
}
