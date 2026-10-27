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
import type { AgentTool, ToolContext, ToolResult } from "./tools";
import { ACTIVE_PHASES } from "@/lib/reports/templates";
import { attachAttachmentsToReport } from "@/lib/reports/attachments";
import { attachSessionToReport } from "@/lib/reports/sessions";
import { ensureJobTreadData, loadSourceRows } from "@/lib/reports/engine";
import { describeSourcesForModel, SOURCE_REGISTRY } from "@/lib/reports/sources";

const SOURCE_LIST = SOURCES.map((x) => `"${x}"`).join("|");

const SPEC_GUIDE = `REPORT SPEC (JSON). Sources (from the source registry; reports_sources has fields, relationships, and freshness):
${describeSourcesForModel()}
Fields: "job.*" built-ins (incl. job.orderGrossProfit, job.orderPrice, job.orderCost from customer orders), "cf:<id>" custom fields, "sem:<key>" business names, and each source's own prefix (see above). Use keys exactly as reports_list_fields returns them. A report can have several datasets from different sources; combine related sources by filtering/grouping on their link fields (e.g. item.model), never by duplicating rows.
Commissions: dataset {"id","source":"commissions","ruleSet":<key from reports_rules>} — one row per project × salesperson with com.salesperson, com.jobName, com.grossProfit, com.ratePct, com.splitPct, com.commission, com.date, com.status. Editors: {"id","type":"rate_editor","ruleSet"} and {"id","type":"assignment_editor","ruleSet"} let authorized people set rates and assign projects in the report. A per-salesperson view is a "select" control on com.salesperson (use "default":[name] for a salesperson-specific copy).
{ "title": str, "description": str,
  "datasets": [{ "id": "active_jobs", "source": ${SOURCE_LIST}, "label": str, "filters": [Condition] }],
  "controls": [ { "id","kind":"job_picker","label","dataset" } | { "id","kind":"select","label","field","datasets":[id] } | { "id","kind":"search","label","fields":[f],"datasets":[id] } | { "id","kind":"number_range"|"date_range","label","field","datasets":[id] } ],
  "widgets": [ (order = layout; "span": 3|4|6|8|12; optional "title","description","height":"sm"|"md"|"lg"|"auto")
    { "id","type":"kpi","dataset","metric":{ "op":"count"|"count_distinct"|"sum"|"avg"|"median"|"min"|"max","field"? },"filters":[Condition],"format":"auto"|"number"|"currency"|"percent"|"sqft" } (percent values are 0–100)
    { "id","type":"chart","dataset","chart":"bar"|"horizontal_bar"|"stacked_bar"|"line"|"area"|"donut"|"scatter"|"histogram","groupBy":f,"seriesBy"?:f,"metric":Metric,"x"?:f,"y"?:f (scatter),"bucket"?:"month"|"quarter"|"year","sort":"value_desc"|"value_asc"|"label","limit":1-50 }
    { "id","type":"table","dataset","columns":[{ "field","label"?,"format"? }],"sort":[{ "field","dir":"asc"|"desc" }],"groupBy"?:f,"pageSize":5-100,"rowDrilldown":bool,"comparable":bool,"highlight":[{ "field","op","value","tone":"green"|"amber"|"red"|"blue" }],"summarize"?:bool } (summarize: one row per distinct text-column combination, amount columns summed, plus a Lines count — e.g. columns item.model, item.option, item.cost, item.price for option totals per model; keep unit cost/price out of summary tables)
    { "id","type":"project_header","control":<job_picker id>,"fields":[f] }
    { "id","type":"detail","control":<job_picker id>,"style":"grid"|"long_text"|"badges","fields":[{ "field","label"? }] }
    { "id","type":"milestones","control":<job_picker id>,"show":"schedule"|"checklists"|"all","style":"timeline"|"list" }
    { "id","type":"documents","control":<job_picker id> }
    { "id","type":"text","body":str } (business commentary only — never type sync dates, record counts, or import progress into text; use KPIs or data_status)
    { "id","type":"data_status" } (live: when each dataset the report reads last synced, and whether it's fresh)
    { "id","type":"rate_editor"|"assignment_editor","ruleSet":key } ] }
Condition = { "field", "op":"eq"|"neq"|"in"|"not_in"|"contains"|"not_contains"|"starts_with"|"blank"|"not_blank"|"gt"|"gte"|"lt"|"lte", "value"? }
Ids: lowercase letters/numbers/_/- . Detail/header/milestones/documents widgets need a job_picker control on a jobs dataset.`;

async function accessFor(ctx: ToolContext): Promise<ReportsAccess> {
  const access = await getReportsAccess(ctx.requester);
  if (!access.canUse) throw new Error("The requester doesn't have access to Reports.");
  await ensureJobTreadData();
  return access;
}

function reportUrl(id: string) {
  return `/reports/${id}`;
}

async function sourceRows(source: (typeof SOURCES)[number], ruleSet?: string) {
  if (source === "commissions" && !ruleSet)
    throw new Error('Commission data needs "ruleSet" (see reports_rules).');
  return loadSourceRows(source, ruleSet);
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
  modelUsage: `reports_list_fields {"source": ${SOURCE_LIST}, "search"?: string} — fields available to this requester (key, label, type, fill rate, sample values) plus business names (sem:*) and whether each is mapped. Call this before building any report.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    source: z.enum(SOURCES).default("jobs"),
    ruleSet: z.string().max(60).optional(),
    search: z.string().trim().max(80).optional(),
  }),
  async execute(ctx, raw) {
    const { source, search, ruleSet } = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      search?: string;
      ruleSet?: string;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } =
      source === "commissions" && !ruleSet
        ? { catalog: await getFieldCatalog(), rows: [] }
        : await sourceRows(source, ruleSet);
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
        ? [...catalog.semantic.entries()]
            .filter(([key, s]) => !q || s.label.toLowerCase().includes(q) || key.includes(q))
            .map(([key, s]) => {
              const r = s.ref ? resolveField(catalog, key) : null;
              return {
                key,
                label: s.label,
                mappedTo: r && r.ok ? r.key : null,
                available: Boolean(r && r.ok && canSeeField(access, r.def)),
                note: !s.ref
                  ? (s.description ??
                    "Not mapped to a JobTread field yet — an administrator can map it under Reports → Data settings → Business fields.")
                  : s.unavailable
                    ? s.unavailable
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
        ...(rows.length === 0
          ? {
              dataStatus:
                "No synced JobTread records yet. Tell the requester the data is still being synced (or ask an administrator to run Reports → Data settings → Sync now) and offer to try again; don't conclude that fields are missing.",
            }
          : {}),
        note:
          source === "jobs"
            ? `Active work is identified by the Phase field (sem:phase); the Status field is mostly blank in JobTread. Active phases: ${ACTIVE_PHASES.join(", ")}.`
            : [
                SOURCE_REGISTRY[source].grain,
                ...SOURCE_REGISTRY[source].notes,
                source === "catalog_models"
                  ? `Live: ${rows.filter((r) => Number(r["model.itemCount"] ?? 0) > 0).length} of ${rows.length} models have budget lines in JobTread.`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
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
    ruleSet: z.string().max(60).optional(),
    filters: z.array(conditionSchema).max(10).default([]),
    fields: z.array(z.string().min(3).max(80)).min(1).max(12),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      ruleSet?: string;
      filters: z.infer<typeof conditionSchema>[];
      fields: string[];
      limit: number;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } = await sourceRows(input.source, input.ruleSet);
    const filtered = filterRows(rows, await canonical(input.filters, access));
    const cols = input.fields.map((ref) => {
      const r = resolveField(catalog, ref);
      if (!r.ok) return { ref, error: r.reason };
      if (!canSeeField(access, r.def))
        return { ref, error: `Requires ${CATEGORY_LABELS[r.def.category]} access` };
      return { ref, key: r.key, label: r.def.label };
    });
    const sample = filtered.slice(0, input.limit).map((row) =>
      Object.fromEntries([
        ["id", row.id],
        ...cols
          .filter((c) => "key" in c)
          .map((c) => {
            const v = row[(c as { key: string }).key];
            const s = Array.isArray(v) ? v.join(", ") : v;
            return [
              (c as { label: string }).label,
              typeof s === "string" && s.length > 200 ? `${s.slice(0, 200)}…` : s,
            ];
          }),
      ]),
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
    ruleSet: z.string().max(60).optional(),
    filters: z.array(conditionSchema).max(10).default([]),
    metric: metricSchema,
    groupBy: z.string().min(3).max(80).optional(),
    limit: z.number().int().min(1).max(30).default(15),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      source: (typeof SOURCES)[number];
      ruleSet?: string;
      filters: z.infer<typeof conditionSchema>[];
      metric: z.infer<typeof metricSchema>;
      groupBy?: string;
      limit: number;
    };
    const access = await accessFor(ctx);
    const { catalog, rows } = await sourceRows(input.source, input.ruleSet);
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
    'reports_list {"search"?: string} — reports this requester can open: id, title, updated, canEdit, mine/shared, pinned, groups (empty = ungrouped), fromSuggestion, and isCurrentReport (the report being viewed/edited).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ search: z.string().trim().max(80).optional() }),
  async execute(ctx, raw) {
    const { search } = this.args.parse(raw) as { search?: string };
    const access = await accessFor(ctx);
    const all = await listReportsFor(ctx.requester, access);
    const q = search?.toLowerCase();
    const { listGroupsFor } = await import("@/lib/reports/groups");
    const { groups, membership } = await listGroupsFor(
      { requester: ctx.requester, access },
      { visibleReportIds: new Set(all.map((x) => x.report.id)) },
    );
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const current = ctx.task.allowed_context?.reportId ?? null;
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
        mine: x.report.owner_id === ctx.requester.userId,
        shared: x.report.owner_id !== ctx.requester.userId && !x.report.is_template,
        pinned: x.pinned,
        groups: (membership.get(x.report.id) ?? []).map((id) => groupName.get(id)).filter(Boolean),
        fromSuggestion: x.report.origin_suggestion_key ?? null,
        isCurrentReport: x.report.id === current,
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

/** File a newly saved report into a group; problems are reported, never undo the save. */
async function fileIntoGroup(
  ctx: ToolContext,
  access: ReportsAccess,
  reportId: string,
  groupRef: string,
  create: boolean,
) {
  const { assignReportToGroup, createGroup, findGroupByName, getGroupById } =
    await import("@/lib/reports/groups");
  const c = { requester: ctx.requester, access, actorLabel: `Dexter for ${ctx.requester.label}` };
  try {
    let g = /^[0-9a-f-]{36}$/i.test(groupRef)
      ? await getGroupById(groupRef, c)
      : await findGroupByName(groupRef, c);
    if (!g) {
      if (!create)
        return { filed: false, problem: `No group named "${groupRef}". Ask whether to create it.` };
      g = await createGroup({ ...c, name: groupRef });
    }
    await assignReportToGroup({ ...c, reportId, groupId: g.id });
    return { filed: true, name: g.name };
  } catch (error) {
    return {
      filed: false,
      problem: error instanceof Error ? error.message : "Couldn't file the report.",
    };
  }
}

const createReportTool: AgentTool = {
  key: "reports_create",
  label: "Save a new report",
  description:
    "Validates and saves a new report definition owned by the requester (private until shared).",
  modelUsage: `reports_create {"spec": ReportSpec, "summary"?: string, "group"?: group name or id, "createGroupIfMissing"?: boolean} — validates every field, dry-runs the report, and saves it. Fails with specific problems you must fix (unknown fields, missing controls). Widgets that would be empty are reported back.
Groups: if the person named a group, pass it (createGroupIfMissing only when they asked for a new group by name). If they didn't, you may suggest one obvious existing group (commissions → Sales, design handoff → Design, product comparison → Product Library) and ask before filing; if several fit, ask which. Never make grouping mandatory — leaving it Ungrouped is fine. Editing a report later keeps its group.\n${SPEC_GUIDE}`,
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    spec: z.unknown(),
    summary: z.string().max(300).optional(),
    group: z.string().trim().min(1).max(80).optional(),
    createGroupIfMissing: z.boolean().optional(),
  }),
  async execute(ctx, raw) {
    const input = this.args.parse(raw) as {
      spec: unknown;
      summary?: string;
      group?: string;
      createGroupIfMissing?: boolean;
    };
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
    if (ctx.requester.userId && !ctx.task.allowed_context?.reportId) {
      // The draft conversation, its plan, and its attachments now belong to the new report.
      await attachChatToReport(ctx.requester.userId, report.id);
      await attachSessionToReport(ctx.requester.userId, report.id);
      await attachAttachmentsToReport(ctx.requester.userId, report.id);
    }
    // A saved report retires the suggestion the person was building (only on success).
    const completedSuggestion = ctx.requester.userId
      ? await import("@/lib/reports/smart-suggestions")
          .then((m) => m.linkNewReportToSuggestion(ctx.requester.userId!, report))
          .catch(() => null)
      : null;
    const filed = input.group
      ? await fileIntoGroup(
          ctx,
          access,
          report.id,
          input.group,
          Boolean(input.createGroupIfMissing),
        )
      : null;
    return artifactResult(report, `Created report "${report.title}".`, {
      completedSuggestion,
      group: filed,
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
