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
  /** sem:<key> → cf:<id> (or null when unmapped). */
  semantic: Map<string, { label: string; ref: string | null; description: string | null }>;
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
  const jobs = [...JOB_BUILTINS, ...custom];
  const byKey = new Map<string, FieldDef>([...jobs, ...MODEL_FIELDS].map((f) => [f.key, f]));
  const semanticMap = new Map(
    semantic.map((s) => [
      `sem:${s.key}`,
      {
        label: s.label,
        ref: s.custom_field_id ? `cf:${s.custom_field_id}` : null,
        description: s.description,
      },
    ]),
  );
  const catalog: FieldCatalog = {
    bySource: { jobs, catalog_models: MODEL_FIELDS },
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
