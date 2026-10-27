/**
 * Report source registry: everything Reports and Dexter need to know about a source, in one
 * place. Dexter's tools, the Data Catalog, dependency tracking, and drilldowns read this
 * metadata, so registering a source here (plus its loader in engine.ts and fields in
 * fields.ts) makes it discoverable without rewriting Dexter's instructions.
 */

import type { SyncEntityKey } from "@/lib/jobtread/entities";
import { relationshipsFrom } from "./relationships";
import { METRIC_OPS, OPERATORS, SOURCES, type ReportSource } from "./spec";

export type SourceRelationship = {
  to: ReportSource | "jobtread_live";
  cardinality: "many-to-one" | "one-to-many";
  via: string;
  description: string;
};

export type SourceMeta = {
  id: ReportSource;
  label: string;
  description: string;
  /** What one row is. */
  grain: string;
  sourceSystem: string;
  /** Field prefix used by this source's fields. */
  fieldPrefix: string;
  /** Field shown as the record name (scatter labels, drilldown sort). */
  labelField: string;
  /** Default drilldown columns (authorized columns only are shown). */
  drilldownFields: string[];
  /** Synced datasets this source reads (freshness + dependency tracking). */
  syncEntities: SyncEntityKey[];
  relationships: SourceRelationship[];
  /** Guidance for building reports correctly from this source. */
  notes: string[];
};

export const SOURCE_REGISTRY: Record<ReportSource, SourceMeta> = {
  jobs: {
    id: "jobs",
    label: "JobTread jobs",
    description: "Every ADU project with location, customer, projections, and custom fields.",
    grain: "One row per JobTread job.",
    sourceSystem: "JobTread (cached)",
    fieldPrefix: "job.",
    labelField: "job.name",
    drilldownFields: [
      "job.name",
      "job.number",
      "sem:phase",
      "sem:project_manager",
      "sem:model",
      "sem:total_sqft",
    ],
    syncEntities: ["jobs", "custom_fields"],
    relationships: [
      {
        to: "cost_items",
        cardinality: "one-to-many",
        via: "item.job (job budget lines)",
        description: "A job's budget lines are cost items with Belongs To = Job budget.",
      },
      {
        to: "jobtread_live",
        cardinality: "one-to-many",
        via: "project picker",
        description: "Milestones, documents, and files are read live per project.",
      },
    ],
    notes: [
      "Business fields (sem:*) and custom fields (cf:*) are job, location, or customer fields.",
      "job.order* financial fields come from cached customer orders (financial documents).",
    ],
  },
  catalog_models: {
    id: "catalog_models",
    label: "Product Library models",
    description:
      "ADU models (top-level JobTread catalog groups) with JobTread's budget cost/price totals.",
    grain: "One row per Product Library model.",
    sourceSystem: "JobTread (cached)",
    fieldPrefix: "model.",
    labelField: "model.name",
    drilldownFields: ["model.name", "model.series", "model.budgetStatus", "model.basePrice"],
    syncEntities: ["catalog_models", "cost_groups"],
    relationships: [
      {
        to: "cost_items",
        cardinality: "one-to-many",
        via: "item.model / item.modelId (resolved by id through the cost-group hierarchy)",
        description:
          "A model's budget lines, sections, and options (e.g. Exterior Package Options) are cost items.",
      },
    ],
    notes: [
      "model.basePrice is JobTread's budget price total; model.baseCost the cost total.",
      "model.region comes only from admin region rules; it is blank when unmapped.",
    ],
  },
  cost_items: {
    id: "cost_items",
    label: "Cost items",
    description:
      "Every JobTread budget and catalog line with quantity, unit, unit cost, unit price, and extended cost/price, placed in its model → section → option hierarchy.",
    grain: "One row per JobTread cost item (no join fan-out: sums never double count).",
    sourceSystem: "JobTread (cached)",
    fieldPrefix: "item.",
    labelField: "item.name",
    drilldownFields: [
      "item.model",
      "item.groupPath",
      "item.name",
      "item.quantity",
      "item.unit",
      "item.unitCost",
      "item.unitPrice",
      "item.cost",
      "item.price",
    ],
    syncEntities: ["cost_items", "cost_groups", "catalog_models"],
    relationships: [
      {
        to: "catalog_models",
        cardinality: "many-to-one",
        via: "item.modelId",
        description: "Each catalog line belongs to at most one model (the root of its group path).",
      },
      {
        to: "jobs",
        cardinality: "many-to-one",
        via: "item.jobId (JobTread job id)",
        description:
          "Job budget lines belong to one job. Approved job fields (Phase, Status, Project Manager, Customer, Job Number…) are readable on cost-item rows by their job keys (e.g. sem:phase); see relatedFields.",
      },
    ],
    notes: [
      'Filter item.context = "Product Library model" for model pricing; "Other catalog group" holds shared libraries such as Build Ready Selections.',
      "Options: item.optionGroup (e.g. Exterior Package Options) and item.option (e.g. Hayward Modern). Sum item.cost / item.price grouped by item.model and item.option for option totals.",
      "item.price / item.unitPrice are JobTread selling prices; item.cost / item.unitCost are internal costs. Never present cost as price. item.priceStatus flags missing prices.",
      'Job fields on budget lines: filter or group by sem:phase (Phase), sem:status, sem:project_manager, job.number, job.customer, etc. directly on a cost_items dataset (e.g. {"field":"sem:phase","op":"in","value":["BR-Permitting"]}). Catalog lines have no job, so these are blank for them; blank Phase is not a phase.',
    ],
  },
  commissions: {
    id: "commissions",
    label: "Commissions",
    description: "Commission calculations per salesperson and job from Baxter business rules.",
    grain: "One row per job × salesperson assignment.",
    sourceSystem: "Baxter business rules + JobTread documents",
    fieldPrefix: "com.",
    labelField: "com.salesperson",
    drilldownFields: [
      "com.salesperson",
      "com.jobName",
      "com.status",
      "com.date",
      "com.grossProfit",
      "com.ratePct",
      "com.commission",
    ],
    syncEntities: ["jobs", "documents", "custom_fields"],
    relationships: [
      {
        to: "jobs",
        cardinality: "many-to-one",
        via: "com.jobId",
        description: "Each commission row is one job's assignment.",
      },
    ],
    notes: ["Requires a ruleSet on the dataset (reports_rules)."],
  },
};

/** Compact, model-facing summary of every source (used in Dexter's spec guide). */
export function describeSourcesForModel(): string {
  return SOURCES.map((id) => {
    const s = SOURCE_REGISTRY[id];
    const related = relationshipsFrom(id)
      .map(
        (r) =>
          `Related ${r.label.toLowerCase()} fields (via ${r.key}, approved by default): ${r.defaultFields.join(", ")}.`,
      )
      .join(" ");
    return `- "${id}" (${s.fieldPrefix}* fields): ${s.description} ${s.grain} ${s.notes.join(" ")}${related ? ` ${related}` : ""}`;
  }).join("\n");
}

export const SUPPORTED_OPERATIONS = { filters: OPERATORS, aggregations: METRIC_OPS };
