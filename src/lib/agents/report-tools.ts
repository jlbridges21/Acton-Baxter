/**
 * Dexter's reporting tools. Every tool:
 *   - validates its input with Zod,
 *   - re-derives the requester's Reports access (data categories) on each call,
 *   - reads only the reporting cache / validated report definitions — never arbitrary
 *     Pave, SQL, or code,
 *   - returns compact results (schemas, samples, computed numbers), not whole datasets.
 */

import "server-only";

import { z } from "zod";
import {
  getReportsAccess,
  canSeeField,
  CATEGORY_LABELS,
  type ReportsAccess,
} from "@/lib/reports/access";
import { aggregate, asList, computeSeries, filterRows, isBlank } from "@/lib/reports/compute";
import { checkSpecFields, executeReport } from "@/lib/reports/engine";
import { getFieldCatalog, resolveField } from "@/lib/reports/fields";
import { applyReportOps } from "@/lib/reports/ops";
import {
  createReport,
  listReportsFor,
  loadReportFor,
  saveReportVersion,
  attachChatToReport,
} from "@/lib/reports/repo";
import {
  collectFieldRefs,
  conditionSchema,
  metricSchema,
  parseReportSpec,
  SOURCES,
  type ReportSpec,
} from "@/lib/reports/spec";
import { agentDb } from "./store";
import type { AgentTool, ToolContext, ToolResult } from "./tools";
import { jobRowFromCache, isProductModel, modelRowFromCache } from "@/lib/reports/engine";

const SPEC_GUIDE = `REPORT SPEC (JSON). Fields: "job.*" built-ins, "cf:<id>" custom fields, "sem:<key>" business names, "model.*" for catalog_models. Use keys exactly as reports_list_fields returns them.
{ "title": str, "description": str,
  "datasets": [{ "id": "active_jobs", "source": "jobs"|"catalog_models", "label": str, "filters": [Condition] }],
  "controls": [ { "id","kind":"job_picker","label","dataset" } | { "id","kind":"select","label","field","datasets":[id] } | { "id","kind":"search","label","fields":[f],"datasets":[id] } | { "id","kind":"number_range"|"date_range","label","field","datasets":[id] } ],
  "widgets": [ (order = layout; "span": 3|4|6|8|12; optional "title","description","height":"sm"|"md"|"lg"|"auto")
    { "id","type":"kpi","dataset","metric":{ "op":"count"|"count_distinct"|"sum"|"avg"|"median"|"min"|"max","field"? },"filters":[Condition],"format":"auto"|"number"|"currency"|"percent"|"sqft" } (percent values are 0–100)
    { "id","type":"chart","dataset","chart":"bar"|"horizontal_bar"|"stacked_bar"|"line"|"area"|"donut"|"scatter"|"histogram","groupBy":f,"seriesBy"?:f,"metric":Metric,"x"?:f,"y"?:f (scatter),"bucket"?:"month"|"quarter"|"year","sort":"value_desc"|"value_asc"|"label","limit":1-50 }
    { "id","type":"table","dataset","columns":[{ "field","label"?,"format"? }],"sort":[{ "field","dir":"asc"|"desc" }],"groupBy"?:f,"pageSize":5-100,"rowDrilldown":bool,"comparable":bool,"highlight":[{ "field","op","value","tone":"green"|"amber"|"red"|"blue" }] }
    { "id","type":"project_header","control":<job_picker id>,"fields":[f] }
    { "id","type":"detail","control":<job_picker id>,"style":"grid"|"long_text"|"badges","fields":[{ "field","label"? }] }
    { "id","type":"milestones","control":<job_picker id>,"show":"schedule"|"checklists"|"all","style":"timeline"|"list" }
    { "id","type":"documents","control":<job_picker id> }
    { "id","type":"text","body":str } ] }
Condition = { "field", "op":"eq"|"neq"|"in"|"not_in"|"contains"|"not_contains"|"starts_with"|"blank"|"not_blank"|"gt"|"gte"|"lt"|"lte", "value"? }
Ids: lowercase letters/numbers/_/- . Detail/header/milestones/documents widgets need a job_picker control on a jobs dataset.`;

async function accessFor(ctx: ToolContext): Promise<ReportsAccess> {
  const access = await getReportsAccess(ctx.requester);
  if (!access.canUse) throw new Error("The requester doesn't have access to Reports.");
  return access;
}

function reportUrl(id: string) {
  return `/reports/${id}`;
}

async function sourceRows(source: (typeof SOURCES)[number]) {
  const catalog = await getFieldCatalog();
  if (source === "jobs") {
    const rows = await agentDb().select<Parameters<typeof jobRowFromCache>[0]>("jt_jobs", {
      filters: [{ col: "removed_at", op: "is_null" }],
      limit: 20_000,
    });
    return { catalog, rows: rows.map((r) => jobRowFromCache(r, catalog)) };
  }
  const rows = await agentDb().select<
    Parameters<typeof modelRowFromCache>[0] & { description: string | null }
  >("jt_catalog_models", {
    filters: [{ col: "removed_at", op: "is_null" }],
    limit: 5000,
  });
  return { catalog, rows: rows.filter(isProductModel).map(modelRowFromCache) };
}

/** Canonicalize conditions for the viewer; throws on unknown/restricted fields with a clear reason. */
async function canonical(conds: z.infer<typeof conditionSchema>[], access: ReportsAccess) {
  const catalog = await getFieldCatalog();
  return conds.map((c) => {
    const r = resolveField(catalog, c.field);
    if (!r.ok) throw new Error(r.reason);
    if (!canSeeField(access, r.def))
      throw new Error(`${r.def.label} requires "${CATEGORY_LABELS[r.def.category]}" access.`);
    return { ...c, field: r.key };
  });
}

const listFields: AgentTool = {
  key: "reports_list_fields",
  label: "Discover report fields",
  description:
    "Lists the JobTread fields Dexter may use for this person, with how often each is filled and example values.",
  modelUsage:
    'reports_list_fields {"source": "jobs"|"catalog_models", "search"?: string} — fields available to this requester (key, label, type, fill rate, sample values) plus business names (sem:*) and whether each is mapped. Call this before building any report.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    source: z.enum(SOURCES).default("jobs"),
    search: z.string().trim().max(80).optional(),
  }),
  async execute(ctx, raw) {
    const { source, search } = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      search?: string;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } = await sourceRows(source);
    const q = search?.toLowerCase();
    const fields = catalog.bySource[source]
      .filter((f) => canSeeField(access, f))
      .filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
      .map((f) => {
        const values = rows.map((r) => r[f.key]).filter((v) => !isBlank(v));
        const distinct = new Map<string, number>();
        if (f.type !== "text" || values.every((v) => String(v).length < 60)) {
          for (const v of values)
            for (const s of asList(v)) distinct.set(s, (distinct.get(s) ?? 0) + 1);
        }
        return {
          key: f.key,
          label: f.label,
          type: f.type,
          target: f.target,
          filled: `${values.length}/${rows.length}`,
          examples: [...distinct.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([v, n]) => `${v.slice(0, 60)} (${n})`),
          description: f.description,
        };
      });
    const hiddenCategories = (["customer", "financial", "internal"] as const)
      .filter((c) => !access.categories.has(c))
      .map((c) => CATEGORY_LABELS[c]);
    const semantic =
      source === "jobs"
        ? [...catalog.semantic.entries()].map(([key, s]) => {
            const r = s.ref ? resolveField(catalog, key) : null;
            return {
              key,
              label: s.label,
              mappedTo: r && r.ok ? r.key : null,
              available: Boolean(r && r.ok && canSeeField(access, r.def)),
              note: !s.ref
                ? (s.description ?? "Not mapped to a JobTread field.")
                : r && r.ok && !canSeeField(access, r.def)
                  ? "Requester lacks access"
                  : undefined,
            };
          })
        : [];
    return {
      data: {
        source,
        records: rows.length,
        fields,
        businessNames: semantic,
        hiddenCategoriesForThisRequester: hiddenCategories,
        note:
          source === "jobs"
            ? "Active work is identified by the Phase field; the Status field is mostly blank in JobTread."
            : "Models are top-level catalog cost groups; most have budgets pending import.",
      },
      logSummary: `Listed ${fields.length} ${source} field(s).`,
    };
  },
};

const preview: AgentTool = {
  key: "reports_preview",
  label: "Preview records",
  description:
    "Shows a small sample of matching records so Dexter can check real values before building.",
  modelUsage:
    'reports_preview {"source", "filters"?: [Condition], "fields": [field keys, max 12], "limit"?: 1-15} — total matching count + a few sample rows (long text truncated).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    source: z.enum(SOURCES),
    filters: z.array(conditionSchema).max(10).default([]),
    fields: z.array(z.string().min(3).max(80)).min(1).max(12),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      filters: z.infer<typeof conditionSchema>[];
      fields: string[];
      limit: number;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } = await sourceRows(input.source);
    const filtered = filterRows(rows, await canonical(input.filters, access));
    const cols = input.fields.map((ref) => {
      const r = resolveField(catalog, ref);
      if (!r.ok) return { ref, error: r.reason };
      if (!canSeeField(access, r.def))
        return { ref, error: `Requires ${CATEGORY_LABELS[r.def.category]} access` };
      return { ref, key: r.key, label: r.def.label };
    });
    const sample = filtered.slice(0, input.limit).map((row) =>
      Object.fromEntries(
        cols
          .filter((c) => "key" in c)
          .map((c) => {
            const v = row[(c as { key: string }).key];
            const s = Array.isArray(v) ? v.join(", ") : v;
            return [
              (c as { label: string }).label,
              typeof s === "string" && s.length > 200 ? `${s.slice(0, 200)}…` : s,
            ];
          }),
      ),
    );
    return {
      data: { total: filtered.length, columns: cols, sample },
      logSummary: `Previewed ${Math.min(input.limit, filtered.length)} of ${filtered.length} ${input.source} record(s).`,
    };
  },
};

const aggregateTool: AgentTool = {
  key: "reports_aggregate",
  label: "Calculate metrics",
  description:
    "Calculates counts, sums, and averages deterministically — Dexter never does the math itself.",
  modelUsage:
    'reports_aggregate {"source", "filters"?: [Condition], "metric": {"op","field"?}, "groupBy"?: field, "limit"?: 1-30} — exact computed value(s). Use these numbers when describing findings.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    source: z.enum(SOURCES),
    filters: z.array(conditionSchema).max(10).default([]),
    metric: metricSchema,
    groupBy: z.string().min(3).max(80).optional(),
    limit: z.number().int().min(1).max(30).default(15),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      filters: z.infer<typeof conditionSchema>[];
      metric: z.infer<typeof metricSchema>;
      groupBy?: string;
      limit: number;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } = await sourceRows(input.source);
    const filtered = filterRows(rows, await canonical(input.filters, access));
    const resolveVisible = (ref: string) => {
      const r = resolveField(catalog, ref);
      if (!r.ok) throw new Error(r.reason);
      if (!canSeeField(access, r.def))
        throw new Error(`${r.def.label} requires ${CATEGORY_LABELS[r.def.category]} access.`);
      return r;
    };
    const metric = {
      ...input.metric,
      field: input.metric.field ? resolveVisible(input.metric.field).key : undefined,
    };
    if (!input.groupBy) {
      const result = aggregate(filtered, metric);
      return {
        data: { records: filtered.length, ...result },
        logSummary: `Calculated ${input.metric.op} over ${filtered.length} record(s).`,
      };
    }
    const g = resolveVisible(input.groupBy);
    const series = computeSeries({
      rows: filtered,
      groupBy: g.key,
      metric,
      sort: "value_desc",
      limit: input.limit,
    });
    return {
      data: {
        records: filtered.length,
        groupedBy: g.def.label,
        groups: series.points.map((p) => ({ group: p.key, value: p.value, records: p.count })),
        note: series.multiValueNote
          ? "Some records have multiple values and are counted in each group."
          : undefined,
      },
      logSummary: `Grouped ${filtered.length} record(s) by ${g.def.label}.`,
    };
  },
};

const listReports: AgentTool = {
  key: "reports_list",
  label: "List saved reports",
  description: "Lists reports the requester can open.",
  modelUsage:
    'reports_list {"search"?: string} — reports this requester can open (id, title, updated, whether they can edit).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ search: z.string().trim().max(80).optional() }),
  async execute(ctx, raw) {
    const { search } = this.args.parse(raw) as { search?: string };
    const access = await accessFor(ctx);
    const all = await listReportsFor(ctx.requester, access);
    const q = search?.toLowerCase();
    const items = all
      .filter(
        (x) => x.report.status === "active" && (!q || x.report.title.toLowerCase().includes(q)),
      )
      .slice(0, 30)
      .map((x) => ({
        id: x.report.id,
        title: x.report.title,
        template: x.report.is_template,
        updatedAt: x.report.updated_at,
        canEdit: x.permission.canEdit,
      }));
    return { data: items, logSummary: `Listed ${items.length} report(s).` };
  },
};

const getReportTool: AgentTool = {
  key: "reports_get",
  label: "Open a saved report",
  description: "Reads a report's current definition so Dexter can edit it.",
  modelUsage:
    'reports_get {"reportId"} — the current spec, version, and widget statuses for this requester. Always call this before editing.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ reportId: z.string().uuid() }),
  async execute(ctx, raw) {
    const { reportId } = this.args.parse(raw) as { reportId: string };
    const access = await accessFor(ctx);
    const { report, permission } = await loadReportFor(reportId, ctx.requester, access);
    const run = await executeReport({ spec: report.spec, access });
    return {
      data: {
        id: report.id,
        version: report.version,
        canEdit: permission.canEdit,
        spec: report.spec,
        widgetStatus: Object.fromEntries(
          Object.values(run.widgets).map((w) => [
            w.id,
            w.status === "ok" ? "ok" : `${w.status}${w.message ? `: ${w.message}` : ""}`,
          ]),
        ),
      },
      logSummary: `Opened report "${report.title}" (v${report.version}).`,
    };
  },
};

/** Validate fields, dry-run, and summarize widget health for a candidate spec. */
async function verifySpec(spec: ReportSpec, access: ReportsAccess) {
  const { missing, restricted } = await checkSpecFields(spec, access, collectFieldRefs(spec));
  const run = await executeReport({ spec, access });
  const problems = Object.values(run.widgets)
    .filter((w) => w.status === "error" || w.status === "restricted")
    .map((w) => `${w.id}: ${w.status}${w.message ? ` — ${w.message}` : ""}`);
  const empty = Object.values(run.widgets)
    .filter((w) => w.status === "empty")
    .map((w) => w.id);
  return { missing, restricted, problems, empty, issues: run.issues };
}

function artifactResult(
  report: { id: string; title: string; version: number },
  summary: string,
  extra: Record<string, unknown>,
): ToolResult {
  return {
    data: {
      saved: true,
      reportId: report.id,
      url: reportUrl(report.id),
      version: report.version,
      ...extra,
    },
    logSummary: summary,
    artifact: {
      type: "report",
      id: report.id,
      title: report.title,
      url: reportUrl(report.id),
      version: report.version,
    },
  };
}

const createReportTool: AgentTool = {
  key: "reports_create",
  label: "Save a new report",
  description:
    "Validates and saves a new report definition owned by the requester (private until shared).",
  modelUsage: `reports_create {"spec": ReportSpec, "summary"?: string} — validates every field, dry-runs the report, and saves it. Fails with specific problems you must fix (unknown fields, missing controls). Widgets that would be empty are reported back.\n${SPEC_GUIDE}`,
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ spec: z.unknown(), summary: z.string().max(300).optional() }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as { spec: unknown; summary?: string };
    const access = await accessFor(ctx);
    const parsed = parseReportSpec(input.spec);
    if (!parsed.ok)
      return {
        data: { saved: false, problems: parsed.issues },
        logSummary: "Report definition failed validation.",
      };
    const check = await verifySpec(parsed.spec, access);
    if (check.missing.length || check.problems.length) {
      return {
        data: { saved: false, unknownFields: check.missing, widgetProblems: check.problems },
        logSummary: "Report definition referenced unavailable fields.",
      };
    }
    const report = await createReport({
      spec: parsed.spec,
      ownerId: ctx.requester.userId,
      authorKind: "dexter",
      taskId: ctx.task.id,
      summary: input.summary ?? "Created by Dexter",
    });
    if (ctx.requester.userId && !ctx.task.allowed_context?.reportId)
      await attachChatToReport(ctx.requester.userId, report.id);
    return artifactResult(report, `Created report "${report.title}".`, {
      emptyWidgets: check.empty,
      notes: check.issues,
      restrictedForThisUser: check.restricted,
    });
  },
};

const updateReportTool: AgentTool = {
  key: "reports_update",
  label: "Edit a saved report",
  description:
    "Applies structured edits (move, add, change, remove widgets and filters) to an existing report as a new version.",
  modelUsage: `reports_update {"reportId", "expectedVersion": number (from reports_get), "operations": [Op], "summary": string} — preferred for edits; preserves everything you don't touch. Ops:
 {"op":"set_title","title"} | {"op":"set_description","description"} | {"op":"add_widget","widget":Widget,"position":"top"|"bottom"|{"after":id}|{"before":id}}
 {"op":"update_widget","id","changes":{...partial widget...}} (e.g. {"chart":"donut"}, {"span":12}, {"columns":[...]}) | {"op":"remove_widget","id"}
 {"op":"move_widget","id","to":"top"|"bottom"|{"after":id}|{"before":id}} | {"op":"reorder_widgets","order":[ids]}
 {"op":"add_dataset","dataset"} | {"op":"set_dataset_filters","id","filters":[Condition]} | {"op":"add_control","control"} | {"op":"update_control","id","changes"} | {"op":"remove_control","id"}
Use the same spec vocabulary as reports_create.`,
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    reportId: z.string().uuid(),
    expectedVersion: z.number().int().min(1).optional(),
    operations: z.array(z.unknown()).min(1).max(30),
    summary: z.string().trim().min(1).max(300),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      reportId: string;
      expectedVersion?: number;
      operations: unknown[];
      summary: string;
    };
    const access = await accessFor(ctx);
    const { report, permission } = await loadReportFor(input.reportId, ctx.requester, access);
    if (!permission.canEdit)
      return {
        data: {
          saved: false,
          problem: "The requester can view but not edit this report. Offer to duplicate it.",
        },
        logSummary: "Edit refused: no edit permission.",
      };
    const applied = applyReportOps(report.spec, input.operations);
    if (!applied.ok)
      return {
        data: { saved: false, problems: applied.issues },
        logSummary: "Edit operations failed validation.",
      };
    const check = await verifySpec(applied.spec, access);
    // Only block on problems this edit introduces; pre-existing gaps (e.g. an unmapped
    // field in a template) are reported but don't make the report uneditable.
    const before =
      check.missing.length || check.problems.length ? await verifySpec(report.spec, access) : null;
    const newMissing = check.missing.filter((m) => !before?.missing.includes(m));
    const newProblems = check.problems.filter((p) => !before?.problems.includes(p));
    if (newMissing.length || newProblems.length) {
      return {
        data: { saved: false, unknownFields: newMissing, widgetProblems: newProblems },
        logSummary: "Edit referenced unavailable fields.",
      };
    }
    const { report: saved, changes } = await saveReportVersion({
      report,
      spec: applied.spec,
      authorId: ctx.requester.userId,
      authorKind: "dexter",
      summary: input.summary,
      taskId: ctx.task.id,
      expectedVersion: input.expectedVersion,
    });
    return artifactResult(saved, `Updated report "${saved.title}" to v${saved.version}.`, {
      changes: changes.length ? changes : ["No changes"],
      emptyWidgets: check.empty,
      existingGaps: [...check.missing, ...check.problems],
    });
  },
};

export const REPORT_TOOLS: AgentTool[] = [
  listFields,
  preview,
  aggregateTool,
  listReports,
  getReportTool,
  createReportTool,
  updateReportTool,
];
