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

export type FieldCatalog = {
  bySource: Record<ReportSource, FieldDef[]>;
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

export async function getFieldCatalog(): Promise<FieldCatalog> {
  if (cached && Date.now() - cached.at < 30_000) return cached.catalog;
  const [fields, semantic] = await Promise.all([listCustomFields(), listSemanticFields()]);
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
    [...jobs, ...MODEL_FIELDS, ...COMMISSION_FIELDS].map((f) => [f.key, f]),
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
  const catalog: FieldCatalog = {
    bySource: { jobs, catalog_models: MODEL_FIELDS, commissions: COMMISSION_FIELDS },
    byKey,
    semantic: semanticMap,
  };
  cached = { at: Date.now(), catalog };
  return catalog;
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
  if (!def)
    return { ok: false, reason: `Field "${ref}" doesn't exist in the connected JobTread data.` };
  return {
    ok: true,
    def: ref.startsWith("sem:") ? { ...def, label: catalog.semantic.get(ref)!.label } : def,
    key,
  };
}
