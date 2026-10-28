/**
 * Dexter's report-engineering tools (reporting engine 2.0): calculated fields and the Metric
 * Library, relationship discovery and validation, and governed approval of related fields.
 *
 * Everything here works on validated definitions — formulas are parsed into a safe tree,
 * relationships come from the registry (stable JobTread ids only), and the engine does all
 * arithmetic. Field access is re-checked on every call; previews return small samples and
 * computed numbers, never whole datasets.
 */

import "server-only";

import { z } from "zod";
import { canSeeField, requireReportsAccess, type ReportsAccess } from "@/lib/reports/access";
import { previewCalculation } from "@/lib/reports/calc-preview";
import { loadSourceRows } from "@/lib/reports/engine";
import { resolveField } from "@/lib/reports/fields";
import {
  archiveMetric,
  canEditMetric,
  catalogFor,
  listLibraryMetrics,
  metricUsage,
  saveMetric,
} from "@/lib/reports/metrics";
import { getRelatedFieldsOverview, setRelatedField } from "@/lib/reports/related-fields";
import { RELATIONSHIPS, ROLLUPS, type RelationshipId } from "@/lib/reports/relationships";
import { loadReportFor } from "@/lib/reports/repo";
import { calculationSchema, fieldRef, SOURCES, type CalculationSpec } from "@/lib/reports/spec";
import type { AgentTool, ToolContext, ToolResult } from "./tools";

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

/** The report's own calculations (when a report id is given) plus a candidate. */
async function contextCalcs(
  ctx: ToolContext,
  access: ReportsAccess,
  reportId: string | undefined,
): Promise<CalculationSpec[]> {
  if (!reportId) return [];
  const loaded = await loadReportFor(reportId, ctx.requester, access).catch(() => null);
  return loaded?.report.spec.calculations ?? [];
}

// ---------------------------------------------------------------------------
// Calculated fields
// ---------------------------------------------------------------------------

const checkArgs = z.object({
  calculation: calculationSchema,
  /** Validate in the context of this report's own calculations. */
  reportId: z.string().uuid().optional(),
  /** Aggregate formulas: also show the value per group of this field. */
  groupBy: fieldRef.optional(),
  ruleSet: z.string().max(60).optional(),
});

const calculationCheck: AgentTool = {
  key: "reports_calculation_check",
  label: "Validate and preview a calculation",
  description:
    "Checks a calculated field (formula, aggregate formula, or rollup) against real data and previews results — fields, types, blanks, and divide-by-zero — without saving anything.",
  modelUsage: `reports_calculation_check {"calculation": Calculation, "reportId"?, "groupBy"?: field, "ruleSet"?} — ALWAYS run before saving a calculation. Returns problems (fix them), sample values, how many records had blanks or zero divisors, and for aggregate formulas the overall value (and per group with groupBy). Calculation = {"key","label","source","basis":"row"|"aggregate"|"rollup","formula"?,"rollup"?:{"relationship","op","field"?,"filters"?},"type":"number"|"currency"|"percent"|"sqft"|"text"|"date"|"boolean","unit"?,"decimals"?,"description"?}.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: checkArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = checkArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const out = await previewCalculation({
        calculation: a.calculation,
        access,
        context: await contextCalcs(ctx, access, a.reportId),
        groupBy: a.groupBy,
        ruleSet: a.ruleSet,
      });
      const ref = `calc:${a.calculation.key}`;
      return { data: out, logSummary: `Checked ${ref}${out.ok ? "" : " (invalid)"}` };
    });
  },
};

const metricsListArgs = z.object({
  source: z.enum(SOURCES).optional(),
  search: z.string().trim().max(80).optional(),
});

const metricsList: AgentTool = {
  key: "reports_metrics",
  label: "Browse the Metric Library",
  description:
    "Lists saved calculated fields (company and personal metrics) with formulas and usage.",
  modelUsage:
    'reports_metrics {"source"?, "search"?} — saved calculated fields (calc:<key>) usable in any report: formula, basis, type, visibility, whether this person can edit it. Check here before creating a metric that may already exist (reuse it).',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: metricsListArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = metricsListArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const [library, catalog] = await Promise.all([listLibraryMetrics(), catalogFor()]);
      const q = a.search?.toLowerCase();
      const metrics = library
        .filter((m) => !a.source || m.definition.source === a.source)
        .filter(
          (m) =>
            !q ||
            m.key.includes(q) ||
            m.definition.label.toLowerCase().includes(q) ||
            (m.definition.description ?? "").toLowerCase().includes(q),
        )
        .map((m) => {
          const ref = `calc:${m.key}`;
          const def = catalog.calcs.get(ref)?.def;
          return {
            ref,
            label: m.definition.label,
            source: m.definition.source,
            basis: m.definition.basis,
            type: m.definition.type,
            formula: m.definition.formula ?? null,
            rollup: m.definition.rollup ?? null,
            description: m.definition.description ?? null,
            visibility: m.visibility,
            version: m.version,
            canEdit: canEditMetric(access, ctx.requester.userId, m),
            usable: def ? canSeeField(access, def) : false,
            problem: catalog.calcErrors.get(ref) ?? null,
          };
        });
      return { data: { metrics }, logSummary: `Listed ${metrics.length} metric(s)` };
    });
  },
};

const metricSaveArgs = z.object({
  calculation: calculationSchema,
  visibility: z.enum(["private", "company"]).default("private"),
  summary: z.string().trim().max(300).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

const metricSave: AgentTool = {
  key: "reports_metric_save",
  label: "Save a library metric",
  description:
    "Saves a validated calculated field to the Metric Library so any report can reuse it. Company metrics need Reports manager access; every save is versioned.",
  modelUsage:
    'reports_metric_save {"calculation": Calculation, "visibility": "private"|"company", "summary"?, "expectedVersion"?} — save to the Metric Library (reusable as calc:<key> in any report). Use "company" only when the person asks for a shared/canonical metric (Reports managers only); otherwise "private". For a metric used by one report only, prefer reports_update {"op":"set_calculation"} instead. Updating an existing metric needs expectedVersion from reports_metrics.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: metricSaveArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = metricSaveArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const row = await saveMetric({
        definition: a.calculation,
        visibility: a.visibility,
        access,
        userId: ctx.requester.userId,
        authorKind: "dexter",
        summary: a.summary,
        expectedVersion: a.expectedVersion,
      });
      return {
        data: {
          saved: true,
          ref: `calc:${row.key}`,
          version: row.version,
          visibility: row.visibility,
        },
        logSummary: `Saved metric calc:${row.key} v${row.version}`,
      };
    });
  },
};

const metricArchiveArgs = z.object({
  key: z.string().max(41),
  archived: z.boolean().default(true),
});

const metricArchive: AgentTool = {
  key: "reports_metric_archive",
  label: "Archive a library metric",
  description:
    "Archives (or restores) a Metric Library entry. Shows which reports use it; archived metrics keep their history.",
  modelUsage:
    'reports_metric_archive {"key", "archived": true|false} — archive only when the person asks; tell them which reports use it (returned) since those widgets will show a clear "not defined" message.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: metricArchiveArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = metricArchiveArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const key = a.key.replace(/^calc:/, "");
      const usage = await metricUsage(key);
      const row = await archiveMetric({
        key,
        archived: a.archived,
        access,
        userId: ctx.requester.userId,
      });
      return {
        data: {
          ok: true,
          ref: `calc:${row.key}`,
          archived: Boolean(row.archived_at),
          usedBy: usage,
        },
        logSummary: `${a.archived ? "Archived" : "Restored"} metric calc:${key}`,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

const relationshipsArgs = z.object({ source: z.enum(SOURCES).optional() });

const relationships: AgentTool = {
  key: "reports_relationships",
  label: "Discover relationships between sources",
  description:
    "Lists the verified relationships between report sources (stable JobTread ids), with cardinality, approved related fields, and rollups.",
  modelUsage:
    'reports_relationships {"source"?} — how sources connect. "lookups" (many-to-one): approved fields of the related record are readable directly on the source\'s rows (e.g. sem:phase on cost items). "rollups" (one-to-many): aggregate child records onto each parent with a calculation {"basis":"rollup","rollup":{"relationship","op","field"?,"filters"?}} — pre-aggregated by id, so parent totals never double count. Use these instead of saying cross-source reports are unsupported.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: relationshipsArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = relationshipsArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const catalog = await catalogFor();
      const lookups = Object.values(RELATIONSHIPS)
        .filter((r) => !a.source || r.from === a.source || r.to === a.source)
        .map((r) => ({
          id: r.id,
          kind: "lookup",
          from: r.from,
          to: r.to,
          cardinality: "many-to-one",
          joinKey: `${r.key} → ${r.to}.id`,
          description: r.description,
          approvedFields: [...catalog.related[r.from].values()]
            .filter((f) => f.relationship === r.id)
            .filter((f) => {
              const d = catalog.byKey.get(f.key);
              return d && canSeeField(access, d);
            })
            .map((f) => ({ ref: f.ref, key: f.key, label: catalog.byKey.get(f.key)!.label })),
          approveMore:
            access.isAdmin || access.canManage
              ? "reports_relationship_approve_field (admin, confirm first)"
              : "An administrator can approve more fields.",
        }));
      const rollups = Object.values(ROLLUPS)
        .filter((r) => !a.source || r.parent === a.source || r.child === a.source)
        .map((r) => ({
          id: r.id,
          kind: "rollup",
          parent: r.parent,
          child: r.child,
          cardinality: "one-to-many",
          joinKey: `${r.child}.${r.childKey} → ${r.parent}.id`,
          description: r.description,
          example: {
            key: `${r.child}_count`,
            label: `${r.label} count`,
            source: r.parent,
            basis: "rollup",
            rollup: { relationship: r.id, op: "count" },
            type: "number",
          },
        }));
      const { listCompanyRelationships } = await import("@/lib/reports/relationship-store");
      const company = (await listCompanyRelationships())
        .map((r) => r.definition)
        .filter((d) =>
          !a.source
            ? true
            : d.kind === "lookup"
              ? d.from === a.source || d.to === a.source
              : d.parent === a.source || d.child === a.source,
        );
      return {
        data: {
          lookups,
          rollups,
          company,
          note: 'All joins use stable JobTread ids. Need a join that isn\'t listed? Run reports_relationship_discover, then save the verified candidate on the report with reports_update {"op":"set_relationship"} — no approval needed; viewers still need access to each related field.',
        },
        logSummary: `Listed ${lookups.length + rollups.length} relationship(s)`,
      };
    });
  },
};

const relCheckArgs = z.object({
  relationship: z.string().max(60),
  /** For a report-specific relationship. */
  reportId: z.string().uuid().optional(),
  ruleSet: z.string().max(60).optional(),
});

const relationshipCheck: AgentTool = {
  key: "reports_relationship_check",
  label: "Validate a relationship",
  description:
    "Checks a relationship's join keys against real records: matched and unmatched records, and how many children each parent has.",
  modelUsage:
    'reports_relationship_check {"relationship": id, "reportId"? (report-specific ones), "ruleSet"?} — verify keys before relying on a join: matched/unmatched counts, children per parent (min/avg/max), parents without children. Use it to diagnose blank related values.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: relCheckArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = relCheckArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const relationshipsInScope = a.reportId
        ? ((await loadReportFor(a.reportId, ctx.requester, access).catch(() => null))?.report.spec
            .relationships ?? [])
        : [];
      const catalog = await catalogFor({ relationships: relationshipsInScope });
      const problem = catalog.relationshipErrors.get(a.relationship);
      if (problem) throw new Error(problem);
      const lookup = catalog.lookupDefs.get(a.relationship);
      const rollup = catalog.rollupDefs.get(a.relationship);
      if (!lookup && !rollup)
        throw new Error(
          `Unknown relationship. Known: ${[...catalog.lookupDefs.keys(), ...catalog.rollupDefs.keys()].join(", ")}.`,
        );
      const childSource = lookup ? lookup.from : rollup!.child;
      const parentSource = lookup ? lookup.to : rollup!.parent;
      const key = lookup ? lookup.key : rollup!.childKey;
      const [child, parent] = await Promise.all([
        loadSourceRows(childSource, a.ruleSet, { relationships: relationshipsInScope }),
        loadSourceRows(parentSource, a.ruleSet, { relationships: relationshipsInScope }),
      ]);
      const parentIds = new Set(parent.rows.map((r) => r.id));
      const linked = child.rows.filter((r) => typeof r[key] === "string");
      const matched = linked.filter((r) => parentIds.has(String(r[key])));
      const perParent = new Map<string, number>();
      for (const r of matched)
        perParent.set(String(r[key]), (perParent.get(String(r[key])) ?? 0) + 1);
      const counts = [...perParent.values()];
      return {
        data: {
          ok: true,
          relationship: a.relationship,
          joinKey: `${childSource}.${key} → ${parentSource}.id`,
          childRecords: child.rows.length,
          childRecordsWithKey: linked.length,
          matched: matched.length,
          unmatched: linked.length - matched.length,
          parents: parent.rows.length,
          parentsWithChildren: perParent.size,
          childrenPerParent: counts.length
            ? {
                min: Math.min(...counts),
                avg: Math.round((matched.length / counts.length) * 10) / 10,
                max: Math.max(...counts),
              }
            : null,
          grain:
            "Lookups keep one row per child record; rollups produce one value per parent. Neither multiplies rows, so totals stay exact.",
        },
        logSummary: `Checked relationship ${a.relationship}`,
      };
    });
  },
};

const approveArgs = z.object({
  relationship: z.string().max(60),
  ref: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  /** Second call only, after the person confirmed the preview. */
  confirm: z.boolean().default(false),
});

const approveField: AgentTool = {
  key: "reports_relationship_approve_field",
  label: "Approve a related field",
  description:
    "Administrators: make another field of a related record available on a source (e.g. a job field on cost items). Previews first; changes are audited.",
  modelUsage:
    'reports_relationship_approve_field {"relationship", "ref", "enabled"?: true|false, "confirm"?: true} — administrators only. First call (no confirm) returns a preview with the field\'s access category; tell the person, and only after they agree call again with "confirm": true. Use when a report needs a related field that reports_list_fields says isn\'t approved yet.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: approveArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = approveArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      if (!(access.isAdmin || access.canManage))
        throw new Error(
          "Only Reports administrators can approve related fields. Tell the person which field is needed so an administrator can approve it under Reports → Data settings → Relationships.",
        );
      const rel = RELATIONSHIPS[a.relationship as RelationshipId];
      if (!rel)
        throw new Error(`Unknown relationship. Known: ${Object.keys(RELATIONSHIPS).join(", ")}.`);
      const catalog = await catalogFor();
      const r = resolveField(catalog, a.ref);
      if (!r.ok) throw new Error(r.reason);
      if (r.def.source !== rel.to) throw new Error(`"${r.def.label}" isn't a ${rel.to} field.`);
      if (!a.confirm)
        return {
          data: {
            ok: true,
            preview: {
              action: `${a.enabled ? "Make" : "Stop making"} "${r.def.label}" available on ${rel.from} rows (${rel.id}).`,
              accessCategory: r.def.category,
              note: "Viewers still need that access category to see it. Confirm with the person, then call again with confirm: true.",
            },
          },
          logSummary: `Previewed related field ${a.ref}`,
        };
      await setRelatedField(
        { relationship: rel.id, ref: a.ref, enabled: a.enabled },
        ctx.requester.userId ?? "",
      );
      const { recordAudit } = await import("@/lib/agents/audit");
      await recordAudit({
        actor: { userId: ctx.requester.userId, label: `Dexter for ${ctx.requester.label}` },
        action: a.enabled ? "reports.related_field_approved" : "reports.related_field_removed",
        targetType: "bi_related_field",
        targetId: `${rel.id}:${a.ref}`,
        summary: `${a.enabled ? "Approved" : "Removed"} related field ${a.ref} (${rel.id}) via Dexter.`,
      }).catch(() => undefined);
      const overview = await getRelatedFieldsOverview().catch(() => []);
      return {
        data: {
          ok: true,
          applied: true,
          approvedFields: overview.find((o) => o.id === rel.id)?.approved.map((f) => f.ref) ?? [],
        },
        logSummary: `${a.enabled ? "Approved" : "Removed"} related field ${a.ref}`,
      };
    });
  },
};

const discoverArgs = z.object({
  from: z.enum(SOURCES),
  to: z.enum(SOURCES),
  ruleSet: z.string().max(60).optional(),
});

const relationshipDiscover: AgentTool = {
  key: "reports_relationship_discover",
  label: "Discover how two sources join",
  description:
    "Finds stable-id join keys between two report sources by checking real records: match rate, coverage, and cardinality. Read-only.",
  modelUsage: `reports_relationship_discover {"from", "to", "ruleSet"?} — when a report needs fields or totals across two sources that aren't joined yet. Returns candidates (best first) with verdict verified|uncertain|rejected, matchRate, cardinality (perRelated), and ready-made "lookup" (bring the other source's fields onto these rows, many-to-one) and "rollup" (aggregate these rows onto the related record) definitions.
- verified: add it to the report yourself with reports_update {"op":"set_relationship","relationship": candidate.lookup + "fields":[the fields you need]} (or candidate.rollup, then a rollup calculation using its id). No approval is needed; it's reversible and every viewer's field access is still enforced.
- uncertain: tell the person the match rate and ask one focused question before using it.
- none, or only nameOnlyMatches: explain that the sources share no stable id (name matches aren't reliable) and ask how they should be linked; never join on names.
Grain: put fields of the "one" side onto the "many" side with a lookup; totals of the "many" side per "one" record with a rollup — never sum a value looked up from the "one" side across "many" rows.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: discoverArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = discoverArgs.parse(raw);
      if (a.from === a.to) throw new Error("Pick two different sources.");
      const access = await requireReportsAccess(ctx.requester);
      const { discoverRelationships } = await import("@/lib/reports/relationship-discovery");
      const found = await discoverRelationships({ a: a.from, b: a.to, access, ruleSet: a.ruleSet });
      return {
        data: {
          ok: true,
          candidates: found.candidates.slice(0, 6),
          nameOnlyMatches: found.nameOnlyMatches,
          records: found.records,
          summary: found.candidates.some((c) => c.verdict === "verified")
            ? "A verified stable-id join exists."
            : found.candidates.length
              ? "Only uncertain joins found — ask before using one."
              : "No stable-id join found between these sources.",
        },
        logSummary: `Discovered ${found.candidates.length} join candidate(s) ${a.from} ↔ ${a.to}`,
      };
    });
  },
};

const promoteArgs = z.object({
  reportId: z.string().uuid(),
  relationship: z.string().max(60),
  confirm: z.boolean().default(false),
});

const relationshipPromote: AgentTool = {
  key: "reports_relationship_promote",
  label: "Make a relationship company-wide",
  description:
    "Administrators: promote a report's validated relationship so every report can use it. Previews first; audited.",
  modelUsage:
    'reports_relationship_promote {"reportId", "relationship": id, "confirm"?: true} — administrators only, and only when the person asks to share a relationship company-wide. First call previews; after the person agrees, call again with "confirm": true.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: promoteArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = promoteArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const { report } = await loadReportFor(a.reportId, ctx.requester, access);
      const def = report.spec.relationships.find((r) => r.id === a.relationship);
      if (!def) throw new Error(`This report has no relationship "${a.relationship}".`);
      if (!(access.isAdmin || access.canManage))
        throw new Error(
          "Only Reports administrators can make a relationship company-wide. It keeps working in this report.",
        );
      if (!a.confirm)
        return {
          data: {
            ok: true,
            preview: {
              action: `Make "${def.label}" (${def.id}) available to every report.`,
              definition: def,
              note: "Confirm with the person, then call again with confirm: true.",
            },
          },
          logSummary: `Previewed promoting relationship ${def.id}`,
        };
      const { promoteRelationship } = await import("@/lib/reports/relationship-store");
      const row = await promoteRelationship({
        definition: def,
        access,
        userId: ctx.requester.userId,
        reportId: report.id,
      });
      const { recordAudit } = await import("@/lib/agents/audit");
      await recordAudit({
        actor: { userId: ctx.requester.userId, label: `Dexter for ${ctx.requester.label}` },
        action: "reports.relationship_promoted",
        targetType: "bi_report_relationship",
        targetId: row.id,
        summary: `Promoted relationship ${def.id} from report ${report.id} to company-wide.`,
      }).catch(() => undefined);
      return {
        data: { ok: true, applied: true, id: def.id },
        logSummary: `Promoted relationship ${def.id}`,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Native field catalog, audit, and repair
// ---------------------------------------------------------------------------

const fieldsArgs = z.object({
  entity: z.string().max(40).optional(),
  search: z.string().trim().max(80).optional(),
  status: z.enum(["active", "stale", "excluded", "unsupported"]).optional(),
  type: z.string().max(30).optional(),
  offset: z.number().int().min(0).max(5000).default(0),
});

const fieldsTool: AgentTool = {
  key: "reports_fields",
  label: "Search the JobTread field catalog",
  description:
    "Searches every discovered JobTread field by entity, current or old name, business name, id, type, and status — only fields this person may see.",
  modelUsage:
    'reports_fields {"entity"?: "job"|"location"|"customer"|… (loose names like "jobs" or "custom fields" work), "search"?: name/old name/sem key/id, "status"?: "active"|"stale"|"excluded"|"unsupported", "type"?, "offset"?} — the native catalog: ref (use cf:<id> in new reports — it never changes when a field is renamed), current JobTread label, entity, type, status and why, business names (sem:…) pointing at it, and old names. Prefer native refs; a business name is only for intentional shared vocabulary. Never treat a narrative text field as structured data, and never pick a field by a similar-sounding name.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: fieldsArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = fieldsArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { searchNativeFields, canonicalEntity } = await import("@/lib/reports/field-catalog");
      if (a.entity && !canonicalEntity(a.entity))
        throw new Error(
          `Unknown entity "${a.entity}". Use job, location, customer, customerContact, vendor, vendorContact, dailyLog, or costItem.`,
        );
      const r = await searchNativeFields(access, { ...a, limit: 40 });
      return {
        data: {
          total: r.total,
          offset: r.offset,
          fields: r.fields.map((f) => ({
            ref: f.ref,
            label: f.label,
            entity: f.entity,
            type: f.type,
            status: f.status,
            ...(f.statusReason ? { why: f.statusReason } : {}),
            ...(f.aliases.length ? { businessNames: f.aliases } : {}),
            ...(f.renamedFrom.length ? { formerNames: f.renamedFrom } : {}),
            ...(f.duplicateLabel ? { note: "Another field has the same name — use the ref." } : {}),
            ...(f.typeChange ? { typeChangedFrom: f.typeChange.from } : {}),
          })),
          countsByEntity: r.counts,
          ...(r.total > r.offset + r.fields.length ? { more: "Use offset to page." } : {}),
        },
        logSummary: `Listed ${r.fields.length} of ${r.total} catalog field(s)`,
      };
    });
  },
};

const auditArgs = z.object({ reportId: z.string().uuid().optional() });

const catalogAudit: AgentTool = {
  key: "reports_catalog_audit",
  label: "Audit fields used by reports",
  description:
    "Finds stale, removed, ambiguous, or shared-text fields used by a report (or, for Reports administrators, by every report, saved view, and metric).",
  modelUsage:
    'reports_catalog_audit {"reportId"?} — with a report id: that report\'s field problems (path, ref, kind, message, safe replacement when one is certain). Without: Reports administrators get an organization-wide summary plus business names that need repair. Kinds: stale (removed from JobTread), conflict (business name points at the wrong field — an administrator repairs the name), ambiguous (several possible fields — ask which one, never guess), shared_text (a business name reading a whole narrative field — use the native cf: ref instead), type_changed, missing. Explain findings plainly; offer reports_field_repair for certain replacements.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: auditArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = auditArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { auditAll, auditReport } = await import("@/lib/reports/report-audit");
      if (a.reportId) {
        const { report } = await loadReportFor(a.reportId, ctx.requester, access);
        const findings = await auditReport(report);
        return {
          data: { report: report.title, findings: findings.slice(0, 40), total: findings.length },
          logSummary: `Audited ${report.title}: ${findings.length} finding(s)`,
        };
      }
      if (!(access.isAdmin || access.canManage))
        throw new Error(
          "Organization-wide audits are for Reports administrators; give a report id instead.",
        );
      const [all, catalog] = await Promise.all([
        auditAll({ limit: 40 }),
        import("@/lib/reports/field-catalog").then((m) =>
          m.searchNativeFields(access, { limit: 1 }),
        ),
      ]);
      return {
        data: {
          ...all,
          businessNamesNeedingRepair: catalog.aliases
            .filter((x) => !["ok", "unmapped"].includes(x.status))
            .map((x) => ({
              ref: x.ref,
              status: x.status,
              reason: x.reason,
              ...(x.repair ? { certainRepair: `cf:${x.repair.id} (${x.repair.name})` } : {}),
              ...(x.candidates.length
                ? { candidates: x.candidates.map((c) => `cf:${c.id} (${c.name})`) }
                : {}),
            })),
          repairWhere: "Reports → Data settings → Field catalog",
        },
        logSummary: `Organization audit: ${all.total} finding(s)`,
      };
    });
  },
};

const impactArgs = z.object({
  from: fieldRef,
  to: fieldRef.optional(),
});

const fieldImpact: AgentTool = {
  key: "reports_field_impact",
  label: "Check the impact of replacing a field",
  description:
    "Lists reports, saved views, and metrics that use a field, and checks whether a replacement is compatible — without changing anything.",
  modelUsage:
    'reports_field_impact {"from": ref, "to"?: ref} — before replacing a field: where it is used (reports you can see; everything for administrators) and, with "to", whether the replacement exists, is visible, and has a compatible type. Read-only.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: impactArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = impactArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const { collectRefUses } = await import("@/lib/reports/report-audit");
      const { listReportsFor } = await import("@/lib/reports/repo");
      const visible = await listReportsFor(ctx.requester, access).catch(() => []);
      const uses = visible
        .map((x) => ({
          id: x.report.id,
          title: x.report.title,
          paths: collectRefUses(x.report.spec)
            .filter((u) => u.ref === a.from)
            .map((u) => u.path),
        }))
        .filter((x) => x.paths.length);
      const catalog = await catalogFor();
      const fromDef = resolveField(catalog, a.from);
      let replacement: Record<string, unknown> | null = null;
      if (a.to) {
        const toDef = resolveField(catalog, a.to);
        replacement = !toDef.ok
          ? { ok: false, problem: toDef.reason }
          : !canSeeField(access, toDef.def)
            ? { ok: false, problem: "That field needs access this person doesn't have." }
            : {
                ok: true,
                label: toDef.def.label,
                type: toDef.def.type,
                compatible: !fromDef.ok || fromDef.def.type === toDef.def.type,
                ...(fromDef.ok && fromDef.def.type !== toDef.def.type
                  ? {
                      warning: `Type changes from ${fromDef.def.type} to ${toDef.def.type}; check filters, sorting, and formatting.`,
                    }
                  : {}),
              };
      }
      return {
        data: {
          from: a.from,
          current: fromDef.ok
            ? { label: fromDef.def.label, type: fromDef.def.type }
            : { problem: fromDef.reason },
          usedIn: uses.slice(0, 30),
          reports: uses.length,
          ...(replacement ? { replacement } : {}),
        },
        logSummary: `Impact of ${a.from}: ${uses.length} report(s)`,
      };
    });
  },
};

const repairArgs = z.object({
  reportId: z.string().uuid(),
  /** Explicit replacements; omit to use only certain ones (same JobTread field id). */
  replacements: z.record(fieldRef, fieldRef).optional(),
  dryRun: z.boolean().default(true),
  expectedVersion: z.number().int().min(1).optional(),
});

const fieldRepair: AgentTool = {
  key: "reports_field_repair",
  label: "Repair field references in a report",
  description:
    "Replaces stale or shared-text field references in a report. Dry-run by default; applying saves a new report version (the previous version stays restorable).",
  modelUsage:
    'reports_field_repair {"reportId", "replacements"?: {"sem:old": "cf:<id>"}, "dryRun"?: true (default), "expectedVersion"?} — without replacements it uses only certain repairs (a business name reading a shared field → that same field\'s native ref). Show the dry-run changes, then call with "dryRun": false. Only pass explicit replacements the person chose; never choose between ambiguous candidates yourself.',
  risk: "draft",
  alwaysRequiresApproval: false,
  available: true,
  args: repairArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = repairArgs.parse(raw);
      const access = await requireReportsAccess(ctx.requester);
      const { permission } = await loadReportFor(a.reportId, ctx.requester, access);
      if (!permission.canEdit) throw new Error("The requester can view but not edit this report.");
      const { applyReportRepair, previewReportRepair } = await import("@/lib/reports/report-audit");
      if (a.dryRun) {
        const {
          spec: _s,
          findings,
          ...p
        } = await previewReportRepair({
          reportId: a.reportId,
          access,
          replacements: a.replacements,
        });
        void _s;
        return {
          data: { ...p, findings: findings.slice(0, 20), dryRun: true },
          logSummary: `Repair dry run: ${p.changes.length} change(s)`,
        };
      }
      const {
        spec: _s,
        findings,
        ...r
      } = await applyReportRepair({
        reportId: a.reportId,
        access,
        userId: ctx.requester.userId,
        authorKind: "dexter",
        replacements: a.replacements,
        expectedVersion: a.expectedVersion,
      });
      void _s;
      void findings;
      return {
        data: r,
        logSummary: r.saved ? `Repaired fields: v${r.version}` : "Nothing to repair",
        ...(r.saved
          ? {
              artifact: {
                type: "report" as const,
                id: r.reportId,
                title: r.title,
                url: `/reports/${r.reportId}`,
                version: r.version,
              },
            }
          : {}),
      };
    });
  },
};

export const REPORT_ENGINE_TOOLS: AgentTool[] = [
  fieldsTool,
  catalogAudit,
  fieldImpact,
  fieldRepair,
  calculationCheck,
  metricsList,
  metricSave,
  metricArchive,
  relationships,
  relationshipCheck,
  relationshipDiscover,
  relationshipPromote,
  approveField,
];
