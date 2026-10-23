/**
 * Verified JobTread Data Catalog.
 *
 * For every entity Acton's reporting could use, record what the current grant can actually
 * reach — verified against the live Pave API, not assumed from documentation:
 *
 *   documented  → listed in ENTITY_DEFS (from https://app.jobtread.com/docs)
 *   accessible  → the field resolved in a real query with this grant
 *   populated   → how many records have a value (`where field != null` counts — no values read)
 *   reportable  → Baxter syncs it into the reporting cache today
 *
 * Only metadata and counts are stored. No record values are read for the catalog.
 */

import "server-only";

import { agentDb } from "@/lib/agents/store";
import { getJobTreadConfig, JobTreadError, pave, type PaveStats } from "./client";

export type CatalogFieldType =
  "text" | "number" | "currency" | "date" | "boolean" | "option" | "relation";

export type CatalogFieldDef = {
  name: string;
  label: string;
  type: CatalogFieldType;
  description: string;
  /** Relation fields can't be counted with `where`; they're verified by resolving them. */
  relation?: string;
};

export type EntityDef = {
  entity: string;
  label: string;
  description: string;
  /** Synced into Baxter's reporting cache (and therefore usable in reports today). */
  reportable: boolean;
  fields: CatalogFieldDef[];
  relationships: string[];
};

const f = (
  name: string,
  label: string,
  type: CatalogFieldType,
  description: string,
  relation?: string,
): CatalogFieldDef => ({
  name,
  label,
  type,
  description,
  ...(relation ? { relation } : {}),
});

/** Reporting-relevant JobTread entities and their documented fields. */
export const ENTITY_DEFS: EntityDef[] = [
  {
    entity: "jobs",
    label: "Jobs (projects)",
    description: "Every ADU project. The center of most reports.",
    reportable: true,
    relationships: [
      "location → customer account",
      "documents",
      "tasks",
      "cost items",
      "files",
      "daily logs",
      "custom field values",
    ],
    fields: [
      f("name", "Job name", "text", "Project name."),
      f("number", "Job number", "text", "JobTread job number."),
      f("createdAt", "Created", "date", "When the job was created in JobTread."),
      f("closedOn", "Closed on", "date", "When the job was closed."),
      f("status", "Status", "text", "JobTread's built-in job status."),
      f("description", "Description", "text", "Job description."),
      f(
        "projectedPrice",
        "Projected price",
        "currency",
        "Price from the approved customer order (JobTread's projection).",
      ),
      f(
        "projectedCost",
        "Projected cost",
        "currency",
        "Cost from the approved customer order (JobTread's projection).",
      ),
      f(
        "actualCost",
        "Actual cost",
        "currency",
        "Costs recorded against the job (vendor bills, time).",
      ),
      f(
        "location",
        "Location",
        "relation",
        "Job site; links to the customer account.",
        "locations",
      ),
    ],
  },
  {
    entity: "documents",
    label: "Financial documents",
    description:
      "Customer orders (estimates/contracts), customer invoices, vendor orders and bills — totals only.",
    reportable: true,
    relationships: ["job"],
    fields: [
      f("type", "Type", "option", "customerOrder, customerInvoice, vendorOrder, vendorBill…"),
      f("status", "Status", "option", "draft, pending, approved, denied…"),
      f("number", "Number", "text", "Document number."),
      f("name", "Name", "text", "Document name."),
      f("issueDate", "Issue date", "date", "Date the document was issued."),
      f("dueDate", "Due date", "date", "Payment due date."),
      f("signedAt", "Signed at", "date", "When the customer signed."),
      f("price", "Price", "currency", "Document total price (before tax)."),
      f("cost", "Cost", "currency", "Document total cost."),
      f("tax", "Tax", "currency", "Tax amount."),
      f("amountPaid", "Amount paid", "currency", "Payments applied to the document."),
      f("balance", "Balance", "currency", "Amount still owed."),
      f("job", "Job", "relation", "The job this document belongs to.", "jobs"),
    ],
  },
  {
    entity: "payments",
    label: "Payments",
    description: "Customer payments and payment dates.",
    reportable: false,
    relationships: ["document", "job"],
    fields: [],
  },
  {
    entity: "customFields",
    label: "Custom fields",
    description:
      "Acton's custom fields on jobs, locations, customers, and other records (definitions).",
    reportable: true,
    relationships: ["values on jobs, locations, and accounts"],
    fields: [
      f("name", "Name", "text", "Field name."),
      f("type", "Type", "option", "text, number, option, date, boolean…"),
      f("targetType", "Applies to", "option", "job, location, customer, vendor, contact…"),
    ],
  },
  {
    entity: "costGroups",
    label: "Catalog & budget groups",
    description: "Cost groups. Top-level catalog groups are the Product Library ADU models.",
    reportable: true,
    relationships: ["parent group", "job", "cost items"],
    fields: [
      f("name", "Name", "text", "Group name."),
      f("description", "Description", "text", "Group description."),
      f("quantity", "Quantity", "number", "Group quantity."),
      f("createdAt", "Created", "date", "When the group was created."),
      f("job", "Job", "relation", "Set for job budgets; empty for catalog groups.", "jobs"),
      f("parentCostGroup", "Parent group", "relation", "Parent cost group.", "costGroups"),
    ],
  },
  {
    entity: "costItems",
    label: "Cost items (budget lines)",
    description: "Individual budget and catalog lines with quantity, unit cost, and unit price.",
    reportable: false,
    relationships: ["job", "cost group"],
    fields: [
      f("name", "Name", "text", "Line item name."),
      f("quantity", "Quantity", "number", "Quantity."),
      f("unitCost", "Unit cost", "currency", "Cost per unit."),
      f("unitPrice", "Unit price", "currency", "Price per unit."),
      f("cost", "Cost", "currency", "Extended cost."),
      f("price", "Price", "currency", "Extended price."),
      f("isSelected", "Selected", "boolean", "Whether an option line is selected."),
      f("createdAt", "Created", "date", "When the line was created."),
      f("costCode", "Cost code", "relation", "Cost code.", "costCodes"),
      f("costType", "Cost type", "relation", "Cost type (labor, materials…).", "costTypes"),
      f("job", "Job", "relation", "Job (empty for catalog lines).", "jobs"),
    ],
  },
  {
    entity: "tasks",
    label: "Tasks & schedule",
    description: "Schedule tasks, milestone groups, and checklist items.",
    reportable: false,
    relationships: ["job"],
    fields: [
      f("name", "Name", "text", "Task name."),
      f("startDate", "Start date", "date", "Planned start."),
      f("endDate", "End date", "date", "Planned end."),
      f("completed", "Completed", "number", "Completion flag/count."),
      f("progress", "Progress", "number", "Progress fraction."),
      f(
        "isGroup",
        "Is milestone group",
        "boolean",
        "Group tasks are the milestones (Design, Permitting…).",
      ),
      f("isToDo", "Is to-do", "boolean", "Checklist to-do item."),
      f("createdAt", "Created", "date", "When the task was created."),
      f("job", "Job", "relation", "Job.", "jobs"),
    ],
  },
  {
    entity: "timeEntries",
    label: "Time entries",
    description: "Hours logged by employees (needed for design-hours reports).",
    reportable: false,
    relationships: ["job", "user"],
    fields: [],
  },
  {
    entity: "accounts",
    label: "Accounts (customers & vendors)",
    description: "Customer and vendor accounts.",
    reportable: false,
    relationships: ["primary contact", "locations"],
    fields: [
      f("name", "Name", "text", "Account name."),
      f("type", "Type", "option", "customer or vendor."),
      f("createdAt", "Created", "date", "When the account was created."),
      f("isTaxable", "Taxable", "boolean", "Tax setting."),
      f("primaryContact", "Primary contact", "relation", "Main contact.", "contacts"),
    ],
  },
  {
    entity: "contacts",
    label: "Contacts",
    description: "People on customer and vendor accounts (contact details are customer data).",
    reportable: false,
    relationships: ["account"],
    fields: [
      f("name", "Name", "text", "Contact name."),
      f("title", "Title", "text", "Job title."),
      f("createdAt", "Created", "date", "When the contact was created."),
      f("account", "Account", "relation", "Account.", "accounts"),
    ],
  },
  {
    entity: "locations",
    label: "Locations (job sites)",
    description: "Job site addresses, with site & utility custom fields.",
    reportable: true,
    relationships: ["account", "jobs"],
    fields: [
      f("name", "Name", "text", "Location name."),
      f("address", "Address", "text", "Street address."),
      f("city", "City", "text", "City."),
      f("state", "State", "text", "State."),
      f("postalCode", "Postal code", "text", "ZIP code."),
      f("createdAt", "Created", "date", "When the location was created."),
      f("account", "Account", "relation", "Customer account.", "accounts"),
    ],
  },
  {
    entity: "files",
    label: "Files",
    description: "Uploaded files and folders (plans, photos, permits).",
    reportable: false,
    relationships: ["job"],
    fields: [
      f("name", "Name", "text", "File name."),
      f("folder", "Folder", "text", "Folder."),
      f("type", "Type", "text", "MIME type."),
      f("size", "Size", "number", "Bytes."),
      f("createdAt", "Created", "date", "Upload date."),
      f("job", "Job", "relation", "Job.", "jobs"),
    ],
  },
  {
    entity: "dailyLogs",
    label: "Daily logs",
    description: "Field daily logs.",
    reportable: false,
    relationships: ["job", "user"],
    fields: [
      f("date", "Date", "date", "Log date."),
      f("notes", "Notes", "text", "Log notes."),
      f("createdAt", "Created", "date", "When the log was created."),
      f("job", "Job", "relation", "Job.", "jobs"),
      f("user", "User", "relation", "Author.", "users"),
    ],
  },
  {
    entity: "memberships",
    label: "JobTread users",
    description: "People with JobTread logins in the organization.",
    reportable: false,
    relationships: ["user", "role"],
    fields: [
      f("createdAt", "Created", "date", "When the membership was created."),
      f("user", "User", "relation", "User.", "users"),
      f("role", "Role", "relation", "Role.", "roles"),
    ],
  },
];

export type CatalogField = CatalogFieldDef & {
  accessible: boolean;
  /** Records with a value, when JobTread can count it; null when not countable. */
  populated: number | null;
  filterable: boolean;
};

export type EntityCatalogRow = {
  entity: string;
  label: string;
  description: string;
  record_count: number | null;
  accessible: boolean;
  reportable: boolean;
  fields: CatalogField[];
  relationships: string[];
  error: string | null;
  last_verified_at: string;
};

const STALE_MS = 24 * 60 * 60_000;

function missingField(error: unknown): string | null {
  if (!(error instanceof JobTreadError) || error.code !== "BAD_QUERY") return null;
  return /The field "([A-Za-z]+)" does not exist/.exec(error.message)?.[1] ?? null;
}

/** Verify one entity: count, resolvable fields, and populated counts. */
async function verifyEntity(
  def: EntityDef,
  orgId: string,
  stats: PaveStats,
): Promise<EntityCatalogRow> {
  const base = {
    entity: def.entity,
    label: def.label,
    description: def.description,
    reportable: def.reportable,
    relationships: def.relationships,
    last_verified_at: new Date().toISOString(),
  };
  const org = (inner: Record<string, unknown>) => ({
    organization: { $: { id: orgId }, [def.entity]: inner },
  });
  let count: number | null = null;
  try {
    const res = await pave<{ organization: Record<string, { count: number }> }>(
      org({ count: {} }),
      { stats },
    );
    count = res.organization[def.entity]?.count ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "Unavailable";
    return {
      ...base,
      record_count: null,
      accessible: false,
      fields: def.fields.map((x) => ({
        ...x,
        accessible: false,
        populated: null,
        filterable: false,
      })),
      error: message,
    };
  }

  // Resolve fields: drop any the API says don't exist, then retry (bounded).
  const accessible = new Set(def.fields.map((x) => x.name));
  for (let attempt = 0; attempt < def.fields.length && accessible.size; attempt++) {
    const nodes: Record<string, unknown> = { id: {} };
    for (const name of accessible)
      nodes[name] = def.fields.find((x) => x.name === name)!.relation ? { id: {} } : {};
    try {
      await pave(org({ $: { size: 1 }, nodes }), { stats });
      break;
    } catch (error) {
      const name = missingField(error);
      if (!name || !accessible.has(name)) break;
      accessible.delete(name);
    }
  }

  const fields: CatalogField[] = [];
  for (const def2 of def.fields) {
    const ok = accessible.has(def2.name);
    let populated: number | null = null;
    let filterable = false;
    if (ok && !def2.relation && count) {
      try {
        const res = await pave<{ organization: Record<string, { count: number }> }>(
          org({ $: { where: [[def2.name], "!=", null] }, count: {} }),
          { stats },
        );
        populated = res.organization[def.entity]?.count ?? 0;
        filterable = true;
      } catch {
        // Not queryable in JobTread (e.g. computed fields) — accessible but not countable.
      }
    }
    fields.push({ ...def2, accessible: ok, populated, filterable });
  }
  return { ...base, record_count: count, accessible: true, fields, error: null };
}

/** Re-verify every entity against the live API and store the results. */
export async function verifyEntityCatalog(stats: PaveStats): Promise<EntityCatalogRow[]> {
  const config = getJobTreadConfig();
  if (!config) throw new JobTreadError("JobTread isn't connected.", "NOT_CONFIGURED");
  const rows: EntityCatalogRow[] = [];
  for (const def of ENTITY_DEFS) {
    const row = await verifyEntity(def, config.organizationId, stats);
    rows.push(row);
    await agentDb().upsert("jt_entity_catalog", row, ["entity"]);
  }
  return rows;
}

export async function listEntityCatalog(): Promise<EntityCatalogRow[]> {
  const rows = await agentDb().select<EntityCatalogRow>("jt_entity_catalog", {});
  const order = new Map(ENTITY_DEFS.map((d, i) => [d.entity, i]));
  return rows.sort((a, b) => (order.get(a.entity) ?? 99) - (order.get(b.entity) ?? 99));
}

/** True when the catalog has never been verified or is older than a day. */
export async function entityCatalogIsStale(): Promise<boolean> {
  const rows = await listEntityCatalog();
  if (rows.length < ENTITY_DEFS.length) return true;
  const oldest = Math.min(...rows.map((r) => new Date(r.last_verified_at).getTime()));
  return Date.now() - oldest > STALE_MS;
}
