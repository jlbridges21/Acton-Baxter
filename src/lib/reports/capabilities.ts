/**
 * Reporting capability matrix + feasibility engine.
 *
 * Maps business requirements ("gross profit", "payment date", "salesperson") to what Acton's
 * JobTread connection and Baxter configuration can actually supply right now. Every status is
 * computed from live state — the verified entity catalog, field mappings, fill rates, the
 * viewer's access, and configured business rules — never asserted.
 */

import "server-only";

import { isJobTreadConfigured } from "@/lib/jobtread/client";
import { listEntityCatalog, type EntityCatalogRow } from "@/lib/jobtread/catalog";
import { lastSuccessfulSync } from "@/lib/jobtread/sync";
import { canSeeField, CATEGORY_LABELS, type ReportsAccess } from "./access";
import { isBlank, type Row } from "./compute";
import { loadSourceRows } from "./engine";
import { getFieldCatalog, resolveField, type FieldCatalog } from "./fields";
import { listRates, listRuleSets, type RuleSetRow } from "./rules";

export const CAPABILITY_STATUSES = [
  "ready",
  "partial",
  "needs_mapping",
  "needs_business_rules",
  "restricted",
  "unavailable",
  "not_connected",
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const STATUS_TEXT: Record<CapabilityStatus, string> = {
  ready: "Ready",
  partial: "Partially available",
  needs_mapping: "Needs field mapping",
  needs_business_rules: "Needs business rules",
  restricted: "Restricted for you",
  unavailable: "Not in JobTread",
  not_connected: "JobTread not connected",
};

export type Capability = {
  key: string;
  label: string;
  source: string;
  status: CapabilityStatus;
  /** What exists today, with counts. */
  available: string;
  /** What's missing and why it matters (empty when ready). */
  gap: string;
  /** A workable alternative or the action to take. */
  alternative: string | null;
  fields: string[];
};

type Ctx = {
  access: ReportsAccess;
  catalog: FieldCatalog;
  entities: Map<string, EntityCatalogRow>;
  jobs: Row[];
  models: Row[];
  items: Row[];
  ruleSets: RuleSetRow[];
  ratesBySet: Map<string, number>;
  connected: boolean;
  synced: boolean;
};

function fill(ctx: Ctx, key: string): number {
  return ctx.jobs.filter((r) => !isBlank(r[key])).length;
}

/** Status for a field-backed requirement, honoring mapping, access, and fill rate. */
function fieldCapability(
  ctx: Ctx,
  base: Omit<Capability, "status" | "available" | "gap" | "alternative">,
  ref: string,
  extra: { alternative?: string; minFill?: number } = {},
): Capability {
  const r = resolveField(ctx.catalog, ref);
  if (!r.ok) {
    return {
      ...base,
      status: ref.startsWith("sem:") ? "needs_mapping" : "unavailable",
      available: "—",
      gap: r.reason,
      alternative:
        extra.alternative ??
        "An administrator can map it in Reports → Data settings → Business fields.",
    };
  }
  if (!canSeeField(ctx.access, r.def)) {
    return {
      ...base,
      status: "restricted",
      available: `${r.def.label} exists`,
      gap: `Requires "${CATEGORY_LABELS[r.def.category]}" access.`,
      alternative: "Ask an administrator for access on Dexter's Access tab.",
    };
  }
  const filled = fill(ctx, r.key);
  const total = ctx.jobs.length;
  if (filled === 0) {
    return {
      ...base,
      status: "unavailable",
      available: `${r.def.label} exists but is empty on all ${total} jobs.`,
      gap: "No values to report on yet.",
      alternative:
        extra.alternative ?? "Fill the field in JobTread; reports pick it up on the next sync.",
    };
  }
  const partial = filled < (extra.minFill ?? 0.5) * total;
  return {
    ...base,
    status: partial ? "partial" : "ready",
    available: `${r.def.label}: filled on ${filled} of ${total} jobs.`,
    gap: partial ? `Blank on ${total - filled} jobs; those appear as "(blank)".` : "",
    alternative: partial ? (extra.alternative ?? null) : null,
  };
}

function entityCount(ctx: Ctx, entity: string): number | null {
  return ctx.entities.get(entity)?.record_count ?? null;
}

type CapabilityDef = {
  key: string;
  label: string;
  source: string;
  fields: string[];
  resolve: (
    ctx: Ctx,
    base: Omit<Capability, "status" | "available" | "gap" | "alternative">,
  ) => Capability;
};

const def = (
  key: string,
  label: string,
  source: string,
  fields: string[],
  resolve: CapabilityDef["resolve"],
): CapabilityDef => ({ key, label, source, fields, resolve });

export const CAPABILITY_DEFS: CapabilityDef[] = [
  def(
    "project_name",
    "Project name & number",
    "JobTread jobs",
    ["job.name", "job.number"],
    (ctx, b) => fieldCapability(ctx, b, "job.name"),
  ),
  def("project_phase", "Project phase", "JobTread job custom field", ["sem:phase"], (ctx, b) =>
    fieldCapability(ctx, b, "sem:phase"),
  ),
  def(
    "project_manager",
    "Project manager",
    "JobTread job custom field",
    ["sem:project_manager"],
    (ctx, b) => fieldCapability(ctx, b, "sem:project_manager", { minFill: 0.1 }),
  ),
  def(
    "salesperson",
    "Salesperson on a project",
    "JobTread Sales Rep field + Baxter assignments",
    ["sem:sales_rep"],
    (ctx, b) =>
      fieldCapability(ctx, b, "sem:sales_rep", {
        minFill: 0.9,
        alternative:
          "Assign projects to salespeople in Baxter (commission reports include an assignment editor).",
      }),
  ),
  def("adu_model", "ADU model on a project", "JobTread job custom field", ["sem:model"], (ctx, b) =>
    fieldCapability(ctx, b, "sem:model", { minFill: 0.1 }),
  ),
  def(
    "recommended_model",
    "Recommended BR model",
    "JobTread customer custom field",
    ["sem:recommended_br_model"],
    (ctx, b) => fieldCapability(ctx, b, "sem:recommended_br_model", { minFill: 0.1 }),
  ),
  def(
    "square_footage",
    "Square footage",
    "JobTread job custom field",
    ["sem:total_sqft"],
    (ctx, b) => fieldCapability(ctx, b, "sem:total_sqft", { minFill: 0.1 }),
  ),
  def("milestones", "Milestones & schedule", "JobTread tasks (live per project)", [], (ctx, b) => {
    const n = entityCount(ctx, "tasks");
    return n
      ? {
          ...b,
          status: "ready",
          available: `${n.toLocaleString()} tasks; milestone groups load live on project pages.`,
          gap: "",
          alternative: null,
        }
      : {
          ...b,
          status: n === 0 ? "unavailable" : "not_connected",
          available: "—",
          gap: "No tasks found.",
          alternative: null,
        };
  }),
  def("documents", "Project files", "JobTread files (live per project)", [], (ctx, b) => {
    const n = entityCount(ctx, "files");
    return n
      ? {
          ...b,
          status: "ready",
          available: `${n.toLocaleString()} files with names and folders.`,
          gap: "File contents and links aren't exposed in reports.",
          alternative: null,
        }
      : { ...b, status: "unavailable", available: "—", gap: "No files found.", alternative: null };
  }),
  def(
    "projected_gross_profit",
    "Gross profit (projected)",
    "JobTread customer orders (price − cost)",
    ["job.orderGrossProfit"],
    (ctx, b) => {
      const cap = fieldCapability(ctx, b, "job.orderGrossProfit", {
        minFill: 0.5,
        alternative:
          "Reports can cover the projects that have a customer order and mark the rest as missing.",
      });
      if (cap.status === "restricted") return cap;
      const approved = ctx.jobs.filter((r) => r["job.orderStatus"] === "approved").length;
      return {
        ...cap,
        available: `${cap.available} Based on customer orders: ${approved} approved, the rest drafts.`,
        gap: [
          cap.gap,
          "Projected, not realized — JobTread has no recorded actual costs for these jobs.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    },
  ),
  def(
    "realized_gross_profit",
    "Gross profit (realized/actual)",
    "JobTread actual costs + payments",
    ["job.actualCost", "job.amountPaid"],
    (ctx, b) => {
      const costs = fill(ctx, "job.actualCost");
      return {
        ...b,
        status: costs ? "partial" : "unavailable",
        available: `${costs} jobs have actual costs; ${entityCount(ctx, "payments") ?? 0} payment records exist.`,
        gap: "Realized profit needs actual costs and collected revenue, which JobTread doesn't hold for Acton yet.",
        alternative:
          "Use projected gross profit from customer orders, clearly labeled as projected.",
      };
    },
  ),
  def(
    "payment_dates",
    "Customer payment dates",
    "JobTread payments",
    ["job.amountPaid"],
    (ctx, b) => {
      const payments = entityCount(ctx, "payments") ?? 0;
      return payments
        ? {
            ...b,
            status: "partial",
            available: `${payments} payments recorded.`,
            gap: "Payments aren't synced into reports yet.",
            alternative: "Ask for payment syncing to be added.",
          }
        : {
            ...b,
            status: "unavailable",
            available: "0 payment records; all customer invoices show $0 paid.",
            gap: "There is no JobTread date for when a customer paid.",
            alternative:
              "Enter the payment (or commission-payable) date per project in Baxter, or use the customer order or invoice date as the trigger.",
          };
    },
  ),
  def("invoices", "Customer invoices", "JobTread documents", ["job.invoicedTotal"], (ctx, b) =>
    fieldCapability(ctx, b, "job.invoicedTotal", {
      minFill: 0.5,
      alternative: "Invoices exist only as drafts for a few jobs today.",
    }),
  ),
  def("design_hours", "Design hours", "JobTread time entries", [], (ctx, b) => {
    const n = entityCount(ctx, "timeEntries") ?? 0;
    return n
      ? {
          ...b,
          status: "partial",
          available: `${n} time entries.`,
          gap: "Time entries aren't synced into reports yet.",
          alternative: null,
        }
      : {
          ...b,
          status: "unavailable",
          available: "0 time entries.",
          gap: "Nobody logs time in JobTread yet.",
          alternative:
            "Start tracking time in JobTread, or keep hours in a spreadsheet Dexter can read as reference.",
        };
  }),
  def(
    "product_specs",
    "ADU model specifications",
    "Product Library (not in JobTread)",
    [],
    (_ctx, b) => ({
      ...b,
      status: "unavailable",
      available: "Model names and budget totals from the JobTread catalog.",
      gap: "Bedrooms, bathrooms, dimensions, and appliances aren't stored in JobTread.",
      alternative:
        "Add catalog custom fields in JobTread, or upload the Product Library spreadsheet as reference.",
    }),
  ),
  def(
    "model_pricing",
    "ADU model base pricing",
    "JobTread catalog",
    ["model.basePrice"],
    (ctx, b) => {
      if (!ctx.access.categories.has("financial"))
        return {
          ...b,
          status: "restricted",
          available: "Model list",
          gap: `Requires "${CATEGORY_LABELS.financial}" access.`,
          alternative: null,
        };
      // Live counts — never a canned statement about import progress.
      const total = ctx.models.length;
      const priced = ctx.models.filter((m) => m["model.basePrice"] !== null).length;
      if (!total)
        return {
          ...b,
          status: "unavailable",
          available: "No Product Library models are synced.",
          gap: "Run a sync (Reports → Data settings).",
          alternative: null,
        };
      return {
        ...b,
        status: priced === total ? "ready" : priced ? "partial" : "unavailable",
        available: `${priced} of ${total} models have budget prices in JobTread.`,
        gap: priced === total ? "" : `${total - priced} models have no budget lines yet.`,
        alternative: null,
      };
    },
  ),
  def(
    "option_pricing",
    "Model option pricing (e.g. exterior packages)",
    "JobTread catalog",
    ["item.option", "item.price"],
    (ctx, b) => {
      if (!ctx.access.categories.has("financial"))
        return {
          ...b,
          status: "restricted",
          available: "Option names",
          gap: `Requires "${CATEGORY_LABELS.financial}" access.`,
          alternative: null,
        };
      const optionItems = ctx.items.filter(
        (i) => i["item.option"] && i["item.context"] === "Product Library model",
      );
      if (!ctx.items.length)
        return {
          ...b,
          status: "unavailable",
          available: "Cost items aren't synced yet.",
          gap: "Enable and sync the Cost items and Cost groups datasets.",
          alternative: null,
        };
      if (!optionItems.length)
        return {
          ...b,
          status: "unavailable",
          available: `${ctx.items.length} cost items synced; none sit in an option group.`,
          gap: "Option groups are groups named “… Options” (or set by an admin rule). Check that Cost groups are synced.",
          alternative: null,
        };
      const models = new Set(optionItems.map((i) => i["item.modelId"]));
      const unpriced = optionItems.filter((i) => i["item.price"] === null).length;
      return {
        ...b,
        status: unpriced ? "partial" : "ready",
        available: `${optionItems.length} option lines across ${models.size} models.`,
        gap: unpriced ? `${unpriced} option lines have no selling price in JobTread.` : "",
        alternative: null,
      };
    },
  ),
  def("commission_rates", "Commission rates", "Baxter business rules", [], (ctx, b) => {
    const withRates = ctx.ruleSets.filter((r) => (ctx.ratesBySet.get(r.id) ?? 0) > 0);
    if (!ctx.ruleSets.length)
      return {
        ...b,
        status: "needs_business_rules",
        available: "Not stored in JobTread.",
        gap: "No commission rules are set up in Baxter yet.",
        alternative:
          "Ask Dexter to set up commission rules; rates are entered in Baxter by an authorized person.",
      };
    if (!withRates.length)
      return {
        ...b,
        status: "needs_business_rules",
        available: `${ctx.ruleSets.length} rule set(s) exist.`,
        gap: "No rates entered yet.",
        alternative: "Enter rates in the report's rate editor.",
      };
    return {
      ...b,
      status: "ready",
      available: `Rates configured in: ${withRates.map((r) => r.name).join(", ")}.`,
      gap: "",
      alternative: null,
    };
  }),
];

async function buildCtx(access: ReportsAccess): Promise<Ctx> {
  const [catalog, entityRows, jobsLoaded, modelsLoaded, itemsLoaded, ruleSets, sync] =
    await Promise.all([
      getFieldCatalog(),
      listEntityCatalog().catch(() => []),
      loadSourceRows("jobs").catch(() => ({ rows: [] as Row[] })),
      loadSourceRows("catalog_models").catch(() => ({ rows: [] as Row[] })),
      loadSourceRows("cost_items").catch(() => ({ rows: [] as Row[] })),
      listRuleSets()
        .then((sets) => sets.filter((r) => r.status === "active"))
        .catch(() => []),
      lastSuccessfulSync().catch(() => null),
    ]);
  const ratesBySet = new Map<string, number>();
  for (const rs of ruleSets) ratesBySet.set(rs.id, (await listRates(rs.id).catch(() => [])).length);
  return {
    access,
    catalog,
    entities: new Map(entityRows.map((e) => [e.entity, e])),
    jobs: jobsLoaded.rows,
    models: modelsLoaded.rows,
    items: itemsLoaded.rows,
    ruleSets,
    ratesBySet,
    connected: isJobTreadConfigured(),
    synced: Boolean(sync),
  };
}

export async function capabilityMatrix(
  access: ReportsAccess,
  keys?: string[],
): Promise<Capability[]> {
  const ctx = await buildCtx(access);
  return CAPABILITY_DEFS.filter((d) => !keys || keys.includes(d.key)).map((d) => {
    const base = { key: d.key, label: d.label, source: d.source, fields: d.fields };
    if (!ctx.connected && !d.source.startsWith("Baxter") && !d.source.startsWith("Product")) {
      return {
        ...base,
        status: "not_connected" as const,
        available: "—",
        gap: "JobTread isn't connected.",
        alternative: "An administrator can connect it in Reports → Data settings.",
      };
    }
    return d.resolve(ctx, base);
  });
}

export type FeasibilityRequirement = { label: string; capability?: string; field?: string };

export type FeasibilityVerdict =
  | "ready"
  | "ready_with_gaps"
  | "needs_mapping"
  | "needs_business_rules"
  | "blocked_permission"
  | "needs_external_data"
  | "not_connected";

/** Assess a set of requirements (capability keys and/or field refs) and summarize. */
export async function assessFeasibility(
  access: ReportsAccess,
  requirements: FeasibilityRequirement[],
) {
  const ctx = await buildCtx(access);
  const byKey = new Map(CAPABILITY_DEFS.map((d) => [d.key, d]));
  const items = requirements.map((req) => {
    if (req.capability && byKey.has(req.capability)) {
      const d = byKey.get(req.capability)!;
      return {
        requirement: req.label,
        ...d.resolve(ctx, { key: d.key, label: d.label, source: d.source, fields: d.fields }),
      };
    }
    if (req.field) {
      return {
        requirement: req.label,
        ...fieldCapability(
          ctx,
          { key: req.field, label: req.label, source: "JobTread", fields: [req.field] },
          req.field,
          { minFill: 0.1 },
        ),
      };
    }
    return {
      requirement: req.label,
      key: "unknown",
      label: req.label,
      source: "—",
      fields: [],
      status: "unavailable" as const,
      available: "—",
      gap: "Not a known capability or field. Use reports_list_fields or reports_capabilities to find one.",
      alternative: null,
    };
  });
  const has = (s: CapabilityStatus) => items.some((i) => i.status === s);
  const verdict: FeasibilityVerdict = !ctx.connected
    ? "not_connected"
    : has("restricted")
      ? "blocked_permission"
      : has("needs_mapping")
        ? "needs_mapping"
        : has("needs_business_rules")
          ? "needs_business_rules"
          : has("unavailable")
            ? "needs_external_data"
            : has("partial")
              ? "ready_with_gaps"
              : "ready";
  return { verdict, synced: ctx.synced, items };
}

export type SuggestedReport = {
  key: string;
  title: string;
  description: string;
  prompt: string;
  requires: string[];
  templateKey?: string;
};

export const SUGGESTED_REPORTS: SuggestedReport[] = [
  {
    key: "active_portfolio",
    title: "Active Project Portfolio",
    description: "Every active project by phase, PM, and model.",
    prompt:
      "Build an active project portfolio: KPIs for active projects by phase, a phase chart, a PM breakdown, and a filterable project table.",
    requires: ["project_phase", "project_manager", "adu_model"],
    templateKey: "active_projects",
  },
  {
    key: "design_handoff",
    title: "Design Handoff",
    description: "Everything design needs for one project.",
    prompt: "Open the Design Handoff template for me.",
    requires: ["project_phase", "milestones", "documents"],
    templateKey: "design_handoff",
  },
  {
    key: "milestone_tracker",
    title: "Project Milestone Tracker",
    description: "Schedule groups and checklist progress per project.",
    prompt:
      "Create a project milestone tracker with a project picker, a milestone timeline, and checklist progress.",
    requires: ["milestones", "project_phase"],
  },
  {
    key: "pm_workload",
    title: "Project Manager Workload",
    description: "Active projects per PM, by phase.",
    prompt:
      "Create a project manager workload report: active projects per PM, split by phase, with a table.",
    requires: ["project_manager", "project_phase"],
  },
  {
    key: "model_comparison",
    title: "ADU Model Comparison",
    description: "Compare Product Library models and pricing.",
    prompt: "Compare ADU models by base price and margin.",
    requires: ["model_pricing"],
    templateKey: "product_library",
  },
  {
    key: "exterior_options",
    title: "Exterior Package Options by Model",
    description: "Every exterior package option per ADU model with cost and selling price.",
    prompt:
      "Create a Product Library report showing each ADU model and all available exterior package options, including their costs and selling prices where available.",
    requires: ["option_pricing"],
    templateKey: "exterior_options",
  },
  {
    key: "cost_per_sqft",
    title: "Projected Price per Square Foot",
    description: "Customer order price ÷ square footage by project.",
    prompt:
      "Show projected price per square foot by project, using customer order price and total square footage.",
    requires: ["projected_gross_profit", "square_footage"],
  },
  {
    key: "profitability",
    title: "Project Profitability (projected)",
    description: "Projected gross profit and margin from customer orders.",
    prompt:
      "Create a projected profitability report: projected gross profit and margin by project and by phase, from customer orders.",
    requires: ["projected_gross_profit"],
  },
  {
    key: "sales_performance",
    title: "Sales Performance",
    description: "Projects and projected gross profit by salesperson.",
    prompt:
      "Create a sales performance report: projects and projected gross profit by salesperson.",
    requires: ["salesperson", "projected_gross_profit"],
  },
  {
    key: "commissions",
    title: "Sales Commission Tracking",
    description: "Commissions from projected gross profit × configured rates.",
    prompt:
      "Create a sales commissions dashboard. Rates and project assignments should be configurable in Baxter.",
    requires: ["salesperson", "projected_gross_profit", "commission_rates", "payment_dates"],
  },
  {
    key: "permitting_pipeline",
    title: "Permitting Pipeline",
    description: "Projects in permitting by permit status.",
    prompt:
      "Create a permitting pipeline report for projects in permitting, grouped by permit status.",
    requires: ["project_phase"],
  },
  {
    key: "design_hours",
    title: "Design Hours by Project",
    description: "Hours logged by designers per project.",
    prompt: "Show design hours by project.",
    requires: ["design_hours"],
  },
  {
    key: "field_explorer",
    title: "JobTread Custom Field Explorer",
    description: "How each custom field is filled across jobs.",
    prompt:
      "Build a custom field explorer: pick a JobTread custom field and see its values across jobs.",
    requires: ["project_name"],
  },
];

export async function suggestedReports(access: ReportsAccess) {
  const matrix = new Map((await capabilityMatrix(access)).map((c) => [c.key, c]));
  return SUGGESTED_REPORTS.map((s) => {
    const caps = s.requires.map((k) => matrix.get(k)!).filter(Boolean);
    const blocking = caps.filter((c) => !["ready", "partial"].includes(c.status));
    const partial = caps.filter((c) => c.status === "partial");
    return {
      ...s,
      status: blocking.length
        ? blocking.every((c) => c.status === "needs_business_rules" || c.key === "payment_dates")
          ? "needs_setup"
          : "blocked"
        : partial.length
          ? "ready_with_gaps"
          : "ready",
      requirements: caps.map((c) => ({
        key: c.key,
        label: c.label,
        status: c.status,
        statusText: STATUS_TEXT[c.status],
        gap: c.gap,
        alternative: c.alternative,
      })),
    };
  });
}
