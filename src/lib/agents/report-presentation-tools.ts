/**
 * Dexter's tools for field mapping health, column formatting, and drill-downs. They use the
 * same infrastructure as the UI:
 *   - reports_field_mappings → the field mapping validator (field-mapping-core.ts)
 *   - reports_format_column  → set_column_format, the config the column editor writes
 *   - reports_drill          → drillGroup, the engine behind the drill drawer
 * Field access, report permissions, and tenant scope are enforced exactly as in the UI.
 */

import "server-only";

import { z } from "zod";
import { requireReportsAccess } from "@/lib/reports/access";
import { COLUMN_PRESETS, findColumn } from "@/lib/reports/column-format";
import { drillGroup, ensureJobTreadData } from "@/lib/reports/engine";
import { getFieldCatalog, resolveField } from "@/lib/reports/fields";
import { applyReportOps, diffSpecs } from "@/lib/reports/ops";
import { ROLLUPS } from "@/lib/reports/relationships";
import { getReportRaw, loadReportFor, saveReportVersion } from "@/lib/reports/repo";
import { ruleActor } from "@/lib/reports/rules";
import { DRILL_RELATED } from "@/lib/reports/spec";
import { styleWarnings } from "@/lib/reports/style";
import { ValidationError } from "@/lib/errors";
import type { AgentTool, ToolResult } from "./tools";

async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "That didn't work.";
    return {
      data: { ok: false, problem: message },
      logSummary: `Refused: ${message.slice(0, 80)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Field mapping health
// ---------------------------------------------------------------------------

const mappingArgs = z.object({
  action: z.enum(["summary", "search", "lookup"]).default("summary"),
  /** search: free text; lookup: a ref, JobTread id, or a field name as a person said it. */
  query: z.string().max(120).optional(),
  entity: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  exclusion: z
    .enum([
      "intentional",
      "unsupported_api",
      "not_synced",
      "synced_not_exposed",
      "permission",
      "broken_mapping",
    ])
    .optional(),
  offset: z.number().int().min(0).max(5000).default(0),
});

const fieldMappingsTool: AgentTool = {
  key: "reports_field_mappings",
  label: "Check JobTread field mappings",
  description:
    "Validates how JobTread fields map into reports (by permanent field id): mapping and sync status, why a field can't be used, and which names are ambiguous.",
  modelUsage:
    'reports_field_mappings {"action": "summary"|"search"|"lookup", "query"?, "entity"?, "status"?, "exclusion"?: intentional|unsupported_api|not_synced|synced_not_exposed|permission|broken_mapping, "offset"?} — "lookup" resolves what a person said ("Phase", an old name, a cf: ref or JobTread id) to exactly one field or returns ambiguous matches (then ask which one — never pick). Each result explains why a field is excluded. Only Reports administrators see fields they can\'t use; other people see only usable fields. This tool never changes mappings; administrators fix them in Reports → Data settings → Field catalog → Field mapping health.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: mappingArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = mappingArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { buildFieldMappingReport, lookupField, queryMappings, visibleTo } =
        await import("@/lib/reports/field-mappings");
      const { canonicalEntity } = await import("@/lib/reports/field-catalog");
      const report = await buildFieldMappingReport(access);
      const admin = access.isAdmin || access.canManage;
      const results = visibleTo(report, access);
      const entity = a.entity ? (canonicalEntity(a.entity) ?? a.entity) : undefined;
      const brief = (r: (typeof results)[number]) => ({
        ref: r.ref,
        label: r.label,
        entity: r.entityLabel,
        type: r.type,
        mapping: r.mappingStatus,
        sync: r.syncStatus,
        ...(r.exclusion ? { excluded: `${r.exclusion.label}: ${r.exclusion.detail}` } : {}),
        ...(r.previousNames.length ? { formerNames: r.previousNames } : {}),
        ...(r.target ? { pointsAt: r.target } : {}),
        ...(admin && r.issues.length
          ? { issues: r.issues.filter((i) => i.severity !== "info").map((i) => i.message) }
          : {}),
      });
      if (a.action === "lookup") {
        const found = lookupField(results, a.query ?? "", { entity });
        return {
          data:
            found.status === "resolved"
              ? { status: "resolved", field: brief(found.result) }
              : found.status === "ambiguous"
                ? { status: "ambiguous", message: found.message, matches: found.matches.map(brief) }
                : found.status === "unavailable"
                  ? { status: "unavailable", message: found.message, field: brief(found.result) }
                  : { status: "not_found", message: found.message },
          logSummary: `Field lookup "${(a.query ?? "").slice(0, 40)}": ${found.status}`,
        };
      }
      if (a.action === "search") {
        const page = queryMappings(results, {
          search: a.query,
          entity,
          status: a.status,
          exclusion: a.exclusion,
          offset: a.offset,
          limit: 40,
        });
        return {
          data: {
            total: page.total,
            offset: page.offset,
            fields: page.results.map(brief),
            ...(page.total > page.offset + page.results.length
              ? { more: "Use offset to page." }
              : {}),
          },
          logSummary: `Listed ${page.results.length} of ${page.total} field mapping(s)`,
        };
      }
      return {
        data: admin
          ? {
              validatedAt: report.validatedAt,
              summary: report.summary,
              needsAttention: report.results
                .filter(
                  (r) =>
                    r.issues.some((i) => i.severity === "error") ||
                    r.mappingStatus === "needs_review",
                )
                .slice(0, 25)
                .map(brief),
            }
          : { usableFields: results.length },
        logSummary: "Field mapping summary",
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Column formatting
// ---------------------------------------------------------------------------

const formatArgs = z.object({
  reportId: z.string().uuid(),
  expectedVersion: z.number().int().min(1).optional(),
  /** Table widget id; optional when the report has exactly one table. */
  widgetId: z.string().max(40).optional(),
  /** The column as the person named it: its label, field name, field ref, or column id. */
  column: z.string().trim().min(1).max(120),
  /** Format patch (merge; null clears a key). */
  format: z.record(z.string(), z.unknown()).optional(),
  /** Apply a built-in or report preset first. */
  preset: z.string().max(40).optional(),
  mode: z.enum(["merge", "replace", "reset"]).default("merge"),
  summary: z.string().trim().max(300).optional(),
  dryRun: z.boolean().default(false),
});

const formatColumnTool: AgentTool = {
  key: "reports_format_column",
  label: "Format a report table column",
  description:
    "Formats one table column (colors, bold, alignment, number format, width, visibility, pinning, conditional colors) by its stable column id — the same settings as the column editor.",
  modelUsage: `reports_format_column {"reportId", "expectedVersion"?, "widgetId"?, "column": label/field/id as the person said it, "format"?: ColumnFormat, "preset"?: ${Object.keys(COLUMN_PRESETS).join("|")}|<report preset key>, "mode"?: "merge"|"replace"|"reset", "dryRun"?} — resolves the column to its stable id first; if the name matches several columns (or several tables), it returns the choices and changes nothing: ask which one. ColumnFormat = {"header"?: {background?, text?, bold?, align?}, "cell"?: {background?, text?, bold?, align?: left|center|right}, "number"?: {style?: number|currency|percent|plain, decimals?: 0-6, thousands?: bool, negative?: minus|parens|red|red_parens, percentInput?: whole|fraction, prefix?, suffix?}, "width"?: 60-600, "hidden"?: bool (hidden by default; viewers can show it), "pin"?: "left"|null, "rules"?: [{"column"?: another column id, "op", "value"?, "style": {color?, background?, emphasis?}}]}. Colors "#rrggbb" or "token:<name>". Rules compare raw values (percent values are 0–100). Formatting never changes values, formulas, filters, or exports; it survives regeneration, reordering, and renames. Examples: "make Margin a percent with one decimal" → {"column":"Margin","format":{"number":{"style":"percent","decimals":1}}}; "negatives in red on Profit" → {"column":"Profit","preset":"negatives_red"}; "highlight price over 100k" → {"column":"Price","format":{"rules":[{"op":"gt","value":100000,"style":{"background":"token:warning"}}]}}. Use "dryRun": true to preview.`,
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: formatArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = formatArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { report, permission } = await loadReportFor(a.reportId, ctx.requester, access);
      if (!permission.canEdit)
        return {
          data: { saved: false, problem: "The requester can view but not edit this report." },
          logSummary: "Format refused: no edit permission.",
        };
      const tables = report.spec.widgets.filter((w) => w.type === "table");
      const widget = a.widgetId
        ? tables.find((w) => w.id === a.widgetId)
        : tables.length === 1
          ? tables[0]
          : undefined;
      if (!widget || widget.type !== "table")
        return {
          data: {
            saved: false,
            ambiguous: !a.widgetId && tables.length > 1,
            problem: a.widgetId
              ? `"${a.widgetId}" isn't a table in this report.`
              : tables.length
                ? "This report has several tables; say which one."
                : "This report has no tables.",
            tables: tables.map((t) => ({ id: t.id, title: t.title })),
          },
          logSummary: "Format: table not resolved.",
        };
      const catalog = await getFieldCatalog();
      const label = (field: string) => {
        const r = resolveField(catalog, field);
        return r.ok ? r.def.label : undefined;
      };
      const columns = widget.columns.map((c) => ({ id: c.id!, field: c.field, label: c.label }));
      const found = findColumn(columns, a.column, label);
      if (found.status !== "found")
        return {
          data: {
            saved: false,
            ambiguous: found.status === "ambiguous",
            problem: found.message,
            columns: columns.map((c) => ({
              id: c.id,
              label: c.label ?? label(c.field) ?? c.field,
            })),
          },
          logSummary: `Format: column ${found.status}.`,
        };
      const presets = { ...COLUMN_PRESETS, ...(report.spec.theme?.columnPresets ?? {}) };
      if (a.preset && !presets[a.preset])
        return {
          data: {
            saved: false,
            problem: `Unknown preset "${a.preset}".`,
            presets: Object.keys(presets),
          },
          logSummary: "Format: unknown preset.",
        };
      const ops: unknown[] = [];
      if (a.preset)
        ops.push({
          op: "set_column_format",
          id: widget.id,
          column: found.id,
          format: presets[a.preset]!.format,
          mode: a.mode === "replace" ? "replace" : "merge",
        });
      if (a.format || a.mode === "reset" || !a.preset)
        ops.push({
          op: "set_column_format",
          id: widget.id,
          column: found.id,
          format: a.format ?? {},
          mode: a.preset && a.mode === "replace" ? "merge" : a.mode,
        });
      const applied = applyReportOps(report.spec, ops);
      if (!applied.ok)
        return {
          data: { saved: false, problems: applied.issues },
          logSummary: "Format failed validation.",
        };
      if (a.dryRun)
        return {
          data: {
            saved: false,
            dryRun: true,
            column: {
              id: found.id,
              label:
                columns.find((c) => c.id === found.id)?.label ??
                label(columns.find((c) => c.id === found.id)!.field),
            },
            format:
              applied.spec.widgets.find((w) => w.id === widget.id)?.type === "table"
                ? ((applied.spec.widgets.find((w) => w.id === widget.id) as typeof widget)
                    .appearance?.columnFormats?.[found.id] ?? null)
                : null,
            changes: diffSpecs(report.spec, applied.spec),
            readabilityWarnings: styleWarnings(applied.spec),
          },
          logSummary: "Format dry run validated.",
        };
      try {
        const { report: saved } = await saveReportVersion({
          report,
          spec: applied.spec,
          authorId: ctx.requester.userId,
          authorKind: "dexter",
          summary: a.summary || applied.summary.join("; "),
          taskId: ctx.task.id,
          expectedVersion: a.expectedVersion,
          ruleActor: ruleActor(ctx.requester.label, ctx.requester.userId, "dexter"),
        });
        return {
          data: {
            saved: true,
            reportId: saved.id,
            version: saved.version,
            column: found.id,
            changes: applied.summary,
            url: `/reports/${saved.id}`,
          },
          logSummary: `Formatted column ${found.id} (v${saved.version}).`,
          artifact: {
            type: "report",
            id: saved.id,
            title: saved.title,
            url: `/reports/${saved.id}`,
            version: saved.version,
          },
        };
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        return { data: { saved: false, problem: error.message }, logSummary: "Format not saved." };
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Drill-downs
// ---------------------------------------------------------------------------

const drillArgs = z.object({
  reportId: z.string().uuid(),
  widgetId: z.string().max(40),
  /** Group labels from the top grouping level down, e.g. ["Design", "Maxx"]. */
  path: z.array(z.string().max(300)).min(1).max(4),
  /** The column whose subtotal to explain (label, field, or id). */
  column: z.string().max(120).optional(),
  /** Ask for a related source; explained when no real relationship exists. */
  related: z.string().max(60).optional(),
  offset: z.number().int().min(0).max(100_000).default(0),
});

const drillTool: AgentTool = {
  key: "reports_drill",
  label: "Drill into a report group",
  description:
    "Lists the records behind a grouped table's group or subtotal (same filters, permissions, and math as the report), with reconciliation against child groups.",
  modelUsage:
    'reports_drill {"reportId", "widgetId", "path": [group labels top-down], "column"?: subtotal column, "related"?: e.g. "cost_items", "offset"?} — the records behind a group (25 per page), the clicked metric (with its formula when calculated), the next level\'s breakdown, and whether child groups reconcile (sums/counts add up; averages, percentages, and ratios are recomputed, never summed). Explain an unavailable relationship plainly instead of guessing a join. Use the report\'s current group labels (from reports_preview or the report view).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: drillArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = drillArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      await ensureJobTreadData();
      const { report } = await loadReportFor(a.reportId, ctx.requester, access);
      let spec = report.spec;
      if (report.is_template) {
        const { templateSafeSpec } = await import("@/lib/reports/rule-scope");
        spec = templateSafeSpec(spec);
      }
      const widget = spec.widgets.find((w) => w.id === a.widgetId);
      if (!widget || widget.type !== "table")
        return {
          data: { ok: false, problem: `"${a.widgetId}" isn't a table in this report.` },
          logSummary: "Drill: not a table.",
        };
      const source = spec.datasets.find((d) => d.id === widget.dataset)?.source;
      if (a.related) {
        const wanted = DRILL_RELATED.find(
          (r) =>
            r === a.related ||
            r.endsWith(`.${a.related}`) ||
            ROLLUPS[r].label.toLowerCase().includes(a.related!.toLowerCase()),
        );
        const available = DRILL_RELATED.filter((r) => source && r.startsWith(`${source}.`));
        if (!wanted || !available.includes(wanted))
          return {
            data: {
              ok: false,
              relationshipUnavailable: true,
              problem: `There's no stable-id relationship from ${source ?? "this table's source"} to "${a.related}", so its records can't be listed under these groups.${available.length ? ` Available: ${available.map((r) => ROLLUPS[r].label).join(", ")}.` : " This source has no related records to drill into."}`,
            },
            logSummary: "Drill: relationship unavailable.",
          };
        spec = {
          ...spec,
          widgets: spec.widgets.map((w) =>
            w.id === widget.id && w.type === "table"
              ? {
                  ...w,
                  drill: { ...(w.drill ?? { enabled: true }), enabled: true, related: wanted },
                }
              : w,
          ),
        };
      }
      let columnId: string | null = null;
      if (a.column) {
        const catalog = await getFieldCatalog();
        const found = findColumn(
          widget.columns.map((c) => ({ id: c.id!, field: c.field, label: c.label })),
          a.column,
          (f) => {
            const r = resolveField(catalog, f);
            return r.ok ? r.def.label : undefined;
          },
        );
        if (found.status !== "found")
          return {
            data: { ok: false, ambiguous: found.status === "ambiguous", problem: found.message },
            logSummary: "Drill: column not resolved.",
          };
        columnId = found.id;
      }
      const r = await drillGroup({
        spec,
        access,
        widgetId: widget.id,
        path: a.path,
        columnId,
        offset: a.offset,
        limit: 25,
      });
      return {
        data: {
          title: r.title,
          breadcrumbs: r.breadcrumbs.map((b) => `${b.fieldLabel}: ${b.label}`),
          filters: r.filters,
          metric: r.metric,
          reconciliation: r.reconciliation,
          next: r.next?.fieldLabel ?? null,
          children: r.children.slice(0, 30),
          records: {
            source: r.records.source,
            total: r.records.total,
            offset: r.records.offset,
            columns: r.records.columns.map((c) => c.label),
            rows: r.records.rows.map((row) =>
              Object.fromEntries(r.records.columns.map((c) => [c.label, row.cells[c.key] ?? null])),
            ),
            subtotals: Object.fromEntries(
              r.records.columns
                .filter((c) => r.records.subtotals[c.key] !== undefined)
                .map((c) => [c.label, r.records.subtotals[c.key]]),
            ),
            ...(r.records.total > r.records.offset + r.records.rows.length
              ? { more: "Use offset to page." }
              : {}),
          },
          notes: r.notes,
        },
        logSummary: `Drilled into ${r.breadcrumbs.map((b) => b.label).join(" › ")} (${r.records.total} records)`,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

const integrityArgs = z.object({ reportId: z.string().uuid() });

const integrityTool: AgentTool = {
  key: "reports_integrity_check",
  label: "Check a report's integrity",
  description:
    "Checks a saved report for missing field mappings, invalid or colliding column ids, stale formatting, invalid drill paths, subtotals that don't reconcile, and access leaks.",
  modelUsage:
    'reports_integrity_check {"reportId"} — read-only. Runs the report with the requester\'s access and returns findings (kind, severity, path, message, fix). Explain errors plainly and offer the fix (reports_format_column / reports_update ops, or an administrator repair); never claim a report is healthy if findings include errors.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: integrityArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = integrityArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      await ensureJobTreadData();
      const { report } = await loadReportFor(a.reportId, ctx.requester, access);
      const { auditReportIntegrity } = await import("@/lib/reports/integrity");
      const stored = await getReportRaw(report.id);
      const r = await auditReportIntegrity({ spec: report.spec, access, rawSpec: stored?.spec });
      return {
        data: { ok: r.ok, summary: r.summary, findings: r.findings.slice(0, 40) },
        logSummary: `Integrity: ${r.findings.length} finding(s)${r.ok ? "" : " incl. errors"}`,
      };
    });
  },
};

export const REPORT_PRESENTATION_TOOLS: AgentTool[] = [
  fieldMappingsTool,
  formatColumnTool,
  drillTool,
  integrityTool,
];
