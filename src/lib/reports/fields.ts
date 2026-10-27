/**
 * Field catalog for reporting: every field a report may reference, with its type,
 * access category, and provenance. Built from built-in attributes plus the discovered
 * JobTread custom fields and the admin-maintained business vocabulary.
 */

import "server-only";

import {
  listCustomFields,
  listSemanticFields,
  type CustomFieldRow,
  type FieldCategory,
} from "@/lib/jobtread/metadata";
import { agentDb } from "@/lib/agents/store";
import { RELATIONSHIPS } from "./relationships";
import type { ReportSource } from "./spec";

export type FieldType =
  "text" | "number" | "currency" | "percent" | "date" | "boolean" | "list" | "url" | "sqft";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  category: Exclude<FieldCategory, "excluded">;
  source: ReportSource;
  /** Where the value comes from, for provenance ("JobTread job custom field 22Pg…"). */
  origin: string;
  customFieldId?: string;
  target?: "job" | "location" | "customer";
  options?: string[];
  multi?: boolean;
  description?: string;
  /** Set on a related field listed under another source (e.g. a job field on cost items). */
  via?: string;
  /** Every access category a viewer needs (calculated fields inherit their inputs'). */
  requires?: Array<Exclude<FieldCategory, "excluded">>;
  /** Calculated field (calc:*). */
  calc?: { basis: "row" | "aggregate" | "rollup"; source: ReportSource };
};

export const JOB_BUILTINS: FieldDef[] = [
  {
    key: "job.name",
    label: "Job Name",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.name",
  },
  {
    key: "job.number",
    label: "Job Number",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.number",
  },
  {
    key: "job.createdAt",
    label: "Created",
    type: "date",
    category: "general",
    source: "jobs",
    origin: "JobTread job.createdAt",
  },
  {
    key: "job.customer",
    label: "Customer",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.location.account.name",
  },
  {
    key: "job.address",
    label: "Address",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.location.address",
  },
  {
    key: "job.city",
    label: "City",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.location.city",
  },
  {
    key: "job.state",
    label: "State",
    type: "text",
    category: "general",
    source: "jobs",
    origin: "JobTread job.location.state",
  },
  {
    key: "job.scheduleStart",
    label: "Schedule Start",
    type: "date",
    category: "general",
    source: "jobs",
    origin: "JobTread job.taskSummary.startDate",
  },
  {
    key: "job.scheduleEnd",
    label: "Schedule End",
    type: "date",
    category: "general",
    source: "jobs",
    origin: "JobTread job.taskSummary.endDate",
  },
  {
    key: "job.progress",
    label: "Schedule Progress",
    type: "percent",
    category: "general",
    source: "jobs",
    origin: "JobTread job.taskSummary.progress",
  },
  {
    key: "job.projectedPrice",
    label: "Projected Price",
    type: "currency",
    category: "financial",
    source: "jobs",
    origin: "JobTread job.projectedPrice (budget sell price)",
    description: "Projected selling price from the job budget. Not revenue received.",
  },
  {
    key: "job.projectedCost",
    label: "Projected Cost",
    type: "currency",
    category: "financial",
    source: "jobs",
    origin: "JobTread job.projectedCost (budget cost)",
    description: "Projected cost from the job budget. Not actual cost incurred.",
  },
  {
    key: "job.projectedMargin",
    label: "Projected Margin",
    type: "currency",
    category: "financial",
    source: "jobs",
    origin: "Derived: projectedPrice − projectedCost",
    description: "Projected price minus projected cost. Not actual gross margin.",
  },
  {
    key: "job.projectedMarginPct",
    label: "Projected Margin %",
    type: "percent",
    category: "financial",
    source: "jobs",
    origin: "Derived: (projectedPrice − projectedCost) ÷ projectedPrice × 100",
  },
];

/** Derived from JobTread documents (src/lib/reports/financials.ts). */
const docField = (
  key: string,
  label: string,
  type: FieldDef["type"],
  category: FieldDef["category"],
  origin: string,
  description: string,
): FieldDef => ({
  key,
  label,
  type,
  category,
  source: "jobs",
  origin,
  description,
});

export const JOB_FINANCIAL_FIELDS: FieldDef[] = [
  docField(
    "job.actualCost",
    "Actual Cost",
    "currency",
    "financial",
    "JobTread job.actualCost",
    "Costs recorded against the job in JobTread.",
  ),
  docField(
    "job.orderPrice",
    "Customer Order Price",
    "currency",
    "financial",
    "JobTread customer order (approved, else latest draft) price",
    "Total price on the job's primary customer order.",
  ),
  docField(
    "job.orderCost",
    "Customer Order Cost",
    "currency",
    "financial",
    "JobTread customer order (approved, else latest draft) cost",
    "Total cost on the job's primary customer order.",
  ),
  docField(
    "job.orderGrossProfit",
    "Projected Gross Profit",
    "currency",
    "financial",
    "Derived: customer order price − cost",
    "Projected, not realized: JobTread has no recorded payments or actual costs for most jobs.",
  ),
  docField(
    "job.orderMarginPct",
    "Projected Gross Margin %",
    "percent",
    "financial",
    "Derived: (order price − cost) ÷ order price × 100",
    "Projected margin from the primary customer order.",
  ),
  docField(
    "job.orderStatus",
    "Customer Order Status",
    "text",
    "general",
    "JobTread customer order status",
    "approved, draft, …",
  ),
  docField(
    "job.orderDate",
    "Customer Order Date",
    "date",
    "general",
    "JobTread customer order issue date",
    "Issue date of the primary customer order.",
  ),
  docField(
    "job.invoicedTotal",
    "Invoiced Total",
    "currency",
    "financial",
    "Sum of JobTread customer invoice prices",
    "Total of all customer invoices on the job.",
  ),
  docField(
    "job.amountPaid",
    "Amount Paid",
    "currency",
    "financial",
    "Sum of JobTread customer invoice amount paid",
    "Payments applied to the job's customer invoices.",
  ),
  docField(
    "job.balanceDue",
    "Balance Due",
    "currency",
    "financial",
    "Sum of JobTread customer invoice balances",
    "Amount still owed on customer invoices.",
  ),
  docField(
    "job.lastInvoiceDate",
    "Last Invoice Date",
    "date",
    "general",
    "Latest JobTread customer invoice issue date",
    "Most recent customer invoice date.",
  ),
];

const comField = (
  key: string,
  label: string,
  type: FieldDef["type"],
  category: FieldDef["category"],
  origin: string,
  description?: string,
): FieldDef => ({
  key,
  label,
  type,
  category,
  source: "commissions",
  origin,
  ...(description ? { description } : {}),
});

/** One row per project × salesperson (src/lib/reports/commissions.ts). */
export const COMMISSION_FIELDS: FieldDef[] = [
  comField(
    "com.salesperson",
    "Salesperson",
    "text",
    "general",
    "Baxter assignment, else JobTread Sales Rep",
  ),
  comField("com.jobName", "Project", "text", "general", "JobTread job.name"),
  comField("com.jobNumber", "Job Number", "text", "general", "JobTread job.number"),
  comField(
    "com.assignmentSource",
    "Assigned Via",
    "text",
    "general",
    "Baxter assignment or JobTread Sales Rep field",
  ),
  comField(
    "com.status",
    "Commission Status",
    "text",
    "general",
    "Derived from gross profit, rate, and date availability",
  ),
  comField(
    "com.date",
    "Commission Date",
    "date",
    "general",
    "Configured date source (see the rule set)",
  ),
  comField("com.orderStatus", "Order Status", "text", "general", "JobTread customer order status"),
  comField(
    "com.grossProfit",
    "Eligible Gross Profit",
    "currency",
    "financial",
    "Configured gross-profit basis (JobTread documents)",
  ),
  comField("com.splitPct", "Split %", "percent", "financial", "Baxter assignment split"),
  comField(
    "com.ratePct",
    "Commission Rate %",
    "percent",
    "financial",
    "Baxter commission rate in effect on the commission date",
  ),
  comField(
    "com.rateSource",
    "Rate Source",
    "text",
    "financial",
    "Project override or salesperson rate",
  ),
  comField(
    "com.commission",
    "Commission",
    "currency",
    "financial",
    "Derived: gross profit × rate % × split %",
    "Calculated by Baxter, not stored in JobTread. Decision support only.",
  ),
  comField("com.notes", "Notes", "text", "general", "Calculation notes"),
];

export const MODEL_FIELDS: FieldDef[] = [
  {
    key: "model.name",
    label: "Model",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin: "JobTread catalog costGroup.name",
  },
  {
    key: "model.series",
    label: "Series",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin: 'Derived from the model name prefix (e.g. "i+", "S", "Age in Place")',
  },
  {
    key: "model.code",
    label: "Model Code",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin: "Derived from the model name (text after the series)",
  },
  {
    key: "model.region",
    label: "Region",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin:
      "Baxter region mapping on the model name (Reports → Data settings → Mappings). Blank when no rule matches — never guessed from the prefix.",
  },
  {
    key: "model.optionGroups",
    label: "Option Groups",
    type: "list",
    category: "general",
    source: "catalog_models",
    origin:
      "Option groups (e.g. Exterior Package Options) found under the model in the cost-group hierarchy",
  },
  {
    key: "model.optionCount",
    label: "Options",
    type: "number",
    category: "general",
    source: "catalog_models",
    origin: "Number of options (groups) inside the model's option groups",
  },
  {
    key: "model.description",
    label: "Description",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin: "JobTread catalog costGroup.description",
  },
  {
    key: "model.budgetStatus",
    label: "Budget Status",
    type: "text",
    category: "general",
    source: "catalog_models",
    origin: 'Derived: "Budget imported" when the model has cost items, else "Pending import"',
  },
  {
    key: "model.itemCount",
    label: "Budget Line Items",
    type: "number",
    category: "general",
    source: "catalog_models",
    origin: "JobTread count of descendant cost items",
  },
  {
    key: "model.baseCost",
    label: "Base Cost",
    type: "currency",
    category: "financial",
    source: "catalog_models",
    origin: "JobTread sum of descendant cost items' cost",
  },
  {
    key: "model.basePrice",
    label: "Base Price",
    type: "currency",
    category: "financial",
    source: "catalog_models",
    origin: "JobTread sum of descendant cost items' price",
  },
  {
    key: "model.profit",
    label: "Profit (Price − Cost)",
    type: "currency",
    category: "financial",
    source: "catalog_models",
    origin: "Derived: base price − base cost",
  },
  {
    key: "model.marginPct",
    label: "Margin %",
    type: "percent",
    category: "financial",
    source: "catalog_models",
    origin: "Derived: (base price − base cost) ÷ base price × 100",
  },
];

const itemField = (
  key: string,
  label: string,
  type: FieldType,
  category: FieldDef["category"],
  origin: string,
  description?: string,
): FieldDef => ({
  key,
  label,
  type,
  category,
  source: "cost_items",
  origin,
  ...(description ? { description } : {}),
});

/** Cost items (budget and catalog lines). One row per JobTread cost item. */
export const ITEM_FIELDS: FieldDef[] = [
  itemField("item.name", "Item", "text", "general", "JobTread costItem.name"),
  itemField(
    "item.description",
    "Item Description",
    "text",
    "general",
    "JobTread costItem.description",
  ),
  itemField(
    "item.context",
    "Belongs To",
    "text",
    "general",
    "Derived from the cost-group hierarchy",
    "Product Library model, Other catalog group (e.g. a shared selections library), Job budget, or Item library (no group).",
  ),
  itemField(
    "item.model",
    "Model",
    "text",
    "general",
    "Root cost group when it is a Product Library model (by id)",
  ),
  itemField(
    "item.modelSeries",
    "Model Series",
    "text",
    "general",
    "Model name prefix (see model.series)",
  ),
  itemField(
    "item.modelRegion",
    "Model Region",
    "text",
    "general",
    "Admin region rule on the model name; blank when unmapped",
  ),
  itemField(
    "item.rootGroup",
    "Top-Level Group",
    "text",
    "general",
    "Root of the JobTread cost-group hierarchy",
  ),
  itemField(
    "item.section",
    "Section",
    "text",
    "general",
    "First group below the root (e.g. Windows, Exterior Package Options)",
  ),
  itemField(
    "item.group",
    "Cost Group",
    "text",
    "general",
    "JobTread costItem.costGroup.name (immediate group)",
  ),
  itemField(
    "item.groupPath",
    "Group Path",
    "text",
    "general",
    "Full JobTread cost-group path, root first",
  ),
  itemField(
    "item.optionGroup",
    "Option Group",
    "text",
    "general",
    'Nearest group named "… Options" (or set by an admin rule)',
    "e.g. Exterior Package Options.",
  ),
  itemField(
    "item.option",
    "Option",
    "text",
    "general",
    "Group directly below the option group on the item's path",
    "e.g. Hayward Modern.",
  ),
  itemField("item.costCode", "Cost Code", "text", "general", "JobTread costItem.costCode.name"),
  itemField("item.costType", "Cost Type", "text", "general", "JobTread costItem.costType.name"),
  itemField("item.unit", "Unit", "text", "general", "JobTread costItem.unit.name"),
  itemField("item.quantity", "Quantity", "number", "general", "JobTread costItem.quantity"),
  itemField("item.unitCost", "Unit Cost", "currency", "financial", "JobTread costItem.unitCost"),
  itemField(
    "item.unitPrice",
    "Unit Price",
    "currency",
    "financial",
    "JobTread costItem.unitPrice (selling price per unit)",
  ),
  itemField("item.cost", "Extended Cost", "currency", "financial", "JobTread costItem.cost"),
  itemField(
    "item.price",
    "Extended Price",
    "currency",
    "financial",
    "JobTread costItem.price (selling price)",
    "Customer-facing selling price from JobTread. Blank when JobTread has no price — never filled from cost.",
  ),
  itemField(
    "item.markupPct",
    "Markup %",
    "percent",
    "financial",
    "Derived: (price − cost) ÷ cost × 100",
  ),
  itemField(
    "item.marginPct",
    "Margin %",
    "percent",
    "financial",
    "Derived: (price − cost) ÷ price × 100",
  ),
  itemField(
    "item.priceStatus",
    "Price Status",
    "text",
    "financial",
    "Derived from JobTread price and cost",
    "Priced in JobTread, Price equals cost (no markup), or No selling price in JobTread.",
  ),
  itemField("item.job", "Job", "text", "general", "JobTread job name (job budget lines only)"),
  itemField(
    "item.modelId",
    "Model ID",
    "text",
    "general",
    "JobTread cost group id of the line's Product Library model (root of its group path)",
    "Stable id of the Product Library model this catalog line belongs to (blank for job budget lines).",
  ),
  itemField(
    "item.jobId",
    "Job ID",
    "text",
    "general",
    "JobTread costItem.job.id",
    "Stable JobTread id of the job this budget line belongs to (blank for catalog lines).",
  ),
  itemField("item.jobNumber", "Job Number", "text", "general", "JobTread job number"),
  itemField("item.taxable", "Taxable", "boolean", "general", "JobTread costItem.isTaxable"),
  itemField(
    "item.sourceItemId",
    "Source Catalog Item",
    "text",
    "general",
    "JobTread costItem.organizationCostItem.id",
  ),
  itemField("item.id", "Cost Item ID", "text", "general", "JobTread costItem.id"),
  itemField(
    "item.syncedAt",
    "Last Synced",
    "date",
    "general",
    "When Baxter last read this item from JobTread",
  ),
];

function customFieldType(f: CustomFieldRow): { type: FieldType; multi: boolean } {
  switch (f.type) {
    case "number":
      return { type: /sq\.?\s?ft|sqft|square/i.test(f.name) ? "sqft" : "number", multi: false };
    case "date":
    case "datetime":
      return { type: "date", multi: false };
    case "boolean":
      return { type: "boolean", multi: false };
    case "url":
      return { type: "url", multi: false };
    case "option":
      // Option fields can hold several values in JobTread (e.g. Electrical).
      return { type: "list", multi: true };
    default:
      return { type: "text", multi: false };
  }
}

/** An approved related field: a target-source field readable from another source's rows. */
export type RelatedField = {
  /** Registry relationship id, or a report/company relationship id. */
  relationship: string;
  /** As approved (built-in key or sem:*). */
  ref: string;
  /** Canonical key on the row (sem:* resolved to its cf:*). */
  key: string;
  approvedBy: "default" | "admin" | "company" | "report";
};

export type RelatedFieldSetting = { relationship: string; field_ref: string; enabled: boolean };

export type FieldCatalog = {
  /** Fields per source, including approved related fields (marked with `via`). */
  bySource: Record<ReportSource, FieldDef[]>;
  /** Approved related fields per source, by canonical key. */
  related: Record<ReportSource, Map<string, RelatedField>>;
  byKey: Map<string, FieldDef>;
  /** sem:<key> → cf:<id> (or null when unmapped). Archived business fields are left out. */
  semantic: Map<
    string,
    {
      label: string;
      ref: string | null;
      description: string | null;
      /** Why a mapped business field can't be used in reports (removed, excluded, non-job target). */
      unavailable?: string;
    }
  >;
};

let cached: { at: number; catalog: FieldCatalog } | null = null;

export function invalidateFieldCatalog(): void {
  cached = null;
}

/** Admin approvals for related fields (migration 078). Without the table, defaults apply. */
async function listRelatedFieldSettings(): Promise<RelatedFieldSetting[]> {
  return agentDb()
    .select<RelatedFieldSetting>("bi_related_fields", { limit: 1000 })
    .catch(() => []);
}

/**
 * Approved related fields per source: each relationship's defaults plus admin approvals,
 * minus admin removals, restricted to fields that exist on the target source.
 */
export function buildRelatedFields(
  base: Pick<FieldCatalog, "bySource" | "byKey" | "semantic">,
  settings: RelatedFieldSetting[],
): { related: FieldCatalog["related"]; listed: Record<ReportSource, FieldDef[]> } {
  const related = {
    jobs: new Map(),
    catalog_models: new Map(),
    cost_items: new Map(),
    commissions: new Map(),
  } as FieldCatalog["related"];
  const listed = { jobs: [], catalog_models: [], cost_items: [], commissions: [] } as Record<
    ReportSource,
    FieldDef[]
  >;
  for (const rel of Object.values(RELATIONSHIPS)) {
    const mine = settings.filter((s) => s.relationship === rel.id);
    const refs = new Map<string, RelatedField["approvedBy"]>(
      rel.defaultFields.map((f) => [f, "default"]),
    );
    for (const s of mine) {
      if (!s.enabled) refs.delete(s.field_ref);
      else if (!refs.has(s.field_ref)) refs.set(s.field_ref, "admin");
    }
    const targetKeys = new Set(base.bySource[rel.to].map((f) => f.key));
    for (const [ref, approvedBy] of refs) {
      const sem = ref.startsWith("sem:") ? base.semantic.get(ref) : undefined;
      if (ref.startsWith("sem:") && (!sem?.ref || sem.unavailable)) continue;
      const key = sem?.ref ?? ref;
      const def = base.byKey.get(key);
      if (!def || !targetKeys.has(key) || related[rel.from].has(key)) continue;
      related[rel.from].set(key, { relationship: rel.id, ref, key, approvedBy });
      listed[rel.from].push({
        ...def,
        label: `${sem?.label ?? def.label} · ${rel.label}`,
        via: rel.id,
        description: `From the related JobTread ${rel.label.toLowerCase()} (${def.origin}).`,
      });
    }
  }
  return { related, listed };
}

export async function getFieldCatalog(): Promise<FieldCatalog> {
  if (cached && Date.now() - cached.at < 30_000) return cached.catalog;
  const [fields, semantic, relatedSettings] = await Promise.all([
    listCustomFields(),
    listSemanticFields(),
    listRelatedFieldSettings(),
  ]);
  const custom: FieldDef[] = fields
    .filter(
      (f) => f.category !== "excluded" && ["job", "location", "customer"].includes(f.target_type),
    )
    .map((f) => {
      const { type, multi } = customFieldType(f);
      const target = f.target_type as "job" | "location" | "customer";
      return {
        key: `cf:${f.id}`,
        label: f.display_name || f.name,
        type,
        multi,
        category: f.category as FieldDef["category"],
        source: "jobs" as const,
        origin: `JobTread ${target} custom field "${f.name}" (${f.id})`,
        customFieldId: f.id,
        target,
        options: f.options,
        description: f.description ?? undefined,
      };
    });
  const jobs = [...JOB_BUILTINS, ...JOB_FINANCIAL_FIELDS, ...custom];
  const byKey = new Map<string, FieldDef>(
    [...jobs, ...MODEL_FIELDS, ...ITEM_FIELDS, ...COMMISSION_FIELDS].map((f) => [f.key, f]),
  );
  const allFields = new Map(fields.map((f) => [f.id, f]));
  const semanticMap: FieldCatalog["semantic"] = new Map(
    semantic
      .filter((s) => !(s as { archived_at?: string | null }).archived_at)
      .map((s) => {
        const cf = s.custom_field_id ? allFields.get(s.custom_field_id) : undefined;
        const unavailable = !s.custom_field_id
          ? undefined
          : !cf
            ? "Its JobTread field no longer exists (an administrator should remap it)."
            : cf.category === "excluded"
              ? "Its JobTread field is excluded from reports by an administrator."
              : !["job", "location", "customer"].includes(cf.target_type)
                ? `It maps to a ${cf.target_type} field; only job, location, and customer field values are in report data today.`
                : undefined;
        return [
          `sem:${s.key}`,
          {
            label: s.label,
            ref: s.custom_field_id ? `cf:${s.custom_field_id}` : null,
            description: s.description,
            ...(unavailable ? { unavailable } : {}),
          },
        ];
      }),
  );
  const own: FieldCatalog["bySource"] = {
    jobs,
    catalog_models: MODEL_FIELDS,
    cost_items: ITEM_FIELDS,
    commissions: COMMISSION_FIELDS,
  };
  const { related, listed } = buildRelatedFields(
    { bySource: own, byKey, semantic: semanticMap },
    relatedSettings,
  );
  const catalog: FieldCatalog = {
    bySource: {
      jobs: [...own.jobs, ...listed.jobs],
      catalog_models: [...own.catalog_models, ...listed.catalog_models],
      cost_items: [...own.cost_items, ...listed.cost_items],
      commissions: [...own.commissions, ...listed.commissions],
    },
    related,
    byKey,
    semantic: semanticMap,
  };
  cached = { at: Date.now(), catalog };
  return catalog;
}

/**
 * Whether a resolved field can be read from a source's rows: its own field, or an approved
 * related field. Otherwise explains why (and whether an administrator can approve it).
 */
export function fieldOnSource(
  catalog: FieldCatalog,
  source: ReportSource,
  def: Pick<FieldDef, "key" | "label" | "source">,
): { ok: true; via?: string } | { ok: false; reason: string; approvable: boolean } {
  if (def.source === source) return { ok: true };
  const rel = catalog.related[source].get(def.key);
  if (rel) return { ok: true, via: rel.relationship };
  const path = Object.values(RELATIONSHIPS).find((r) => r.from === source && r.to === def.source);
  if (path)
    return {
      ok: false,
      approvable: true,
      reason: `"${def.label}" is a ${def.source} field that isn't approved for ${source} reports yet. The ${source} source is linked to ${def.source} (${path.label}), so the report can add it through its own lookup relationship (reports_update set_relationship with key ${path.key} — Dexter does this without approval), or an administrator can approve it for every report under Reports → Data settings → Relationships.`,
    };
  return {
    ok: false,
    approvable: false,
    reason: `"${def.label}" is a ${def.source} field and ${source} rows aren't joined to ${def.source} yet. Find a stable-id join with reports_relationship_discover and add it to the report (set_relationship), or use a rollup calculation for totals of related records.`,
  };
}

/** Resolve any field reference (including sem:) to its definition, or explain why not. */
export function resolveField(
  catalog: FieldCatalog,
  ref: string,
): { ok: true; def: FieldDef; key: string } | { ok: false; reason: string } {
  let key = ref;
  if (ref.startsWith("sem:")) {
    const sem = catalog.semantic.get(ref);
    if (!sem) return { ok: false, reason: `"${ref}" isn't a known business field.` };
    if (!sem.ref) {
      return {
        ok: false,
        reason: `"${sem.label}" isn't mapped to a JobTread field.${sem.description ? ` ${sem.description}` : ""} An administrator can map it under Reports → Data settings.`,
      };
    }
    if (sem.unavailable)
      return { ok: false, reason: `"${sem.label}" can't be used in reports: ${sem.unavailable}` };
    key = sem.ref;
  }
  const def = catalog.byKey.get(key);
  if (!def && ref.startsWith("calc:")) {
    const error = (catalog as { calcErrors?: Map<string, string> }).calcErrors?.get(ref);
    return {
      ok: false,
      reason:
        error ??
        `Calculated field "${ref}" isn't defined. Add it to the report's calculations or the Metric Library.`,
    };
  }
  if (!def)
    return { ok: false, reason: `Field "${ref}" doesn't exist in the connected JobTread data.` };
  return {
    ok: true,
    def: ref.startsWith("sem:") ? { ...def, label: catalog.semantic.get(ref)!.label } : def,
    key,
  };
}
