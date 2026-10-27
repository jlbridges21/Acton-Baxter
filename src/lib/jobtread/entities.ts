/**
 * Sync Manager entity registry: every JobTread dataset Baxter can cache for reporting.
 *
 *   core  — the original reporting cache (custom fields, jobs, documents, catalog models),
 *           synced in one step by the functions in sync.ts.
 *   paged — chunked, checkpointed syncs: one Pave page per step, cursor saved after each page,
 *           resumable after a timeout or crash (see sync-manager.ts).
 *
 * Normalizers copy JobTread values as-is. Missing numbers stay null — never derived or
 * defaulted — so a report can tell "no price in JobTread" apart from "price is 0".
 * Field selections never include contact emails/phones, file URLs, or file contents.
 */

export const SYNC_ENTITY_KEYS = [
  "custom_fields",
  "jobs",
  "documents",
  "catalog_models",
  "cost_groups",
  "cost_items",
  "tasks",
  "accounts",
  "users",
  "contacts",
  "daily_logs",
  "files",
  "payments",
  "time_entries",
] as const;
export type SyncEntityKey = (typeof SYNC_ENTITY_KEYS)[number];

export type Sensitivity = "general" | "customer" | "financial" | "internal";

type Row = Record<string, unknown> & { id: string };
type Node = Record<string, unknown>;

export type NormalizeContext = {
  syncedAt: string;
  /** Custom field ids an admin allowed (category ≠ excluded), per JobTread target type. */
  allowedFields: Map<string, Set<string>>;
};

export type SyncEntityDef = {
  key: SyncEntityKey;
  label: string;
  description: string;
  kind: "core" | "paged";
  /** Entity name in the verified Data Catalog (jt_entity_catalog). */
  catalogEntity: string;
  table: string;
  sensitivity: Sensitivity;
  /** Lower runs first. Dependencies always run before dependents in a batch. */
  priority: number;
  dependsOn: SyncEntityKey[];
  /** What is deliberately never synced for this entity. */
  privacy: string;
  /** Which reports and features use it. */
  usedFor: string;
  connection?: string;
  args?: Record<string, unknown>;
  nodes?: Record<string, unknown>;
  pageSize?: number;
  normalize?: (node: Node, ctx: NormalizeContext) => Row;
};

const rel = { id: {} };
const relNamed = { id: {}, name: {} };

export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const day = (v: unknown): string | null => str(v)?.slice(0, 10) ?? null;
const relId = (v: unknown): string | null =>
  v && typeof v === "object" ? str((v as Node).id) : null;
const relName = (v: unknown): string | null =>
  v && typeof v === "object" ? str((v as Node).name) : null;

/** Custom field values allowed for `targets`, as { fieldId: [values] } (source order). */
export function allowedValues(node: Node, targets: string[], ctx: NormalizeContext) {
  const allowed = new Set(targets.flatMap((t) => [...(ctx.allowedFields.get(t) ?? [])]));
  const out: Record<string, string[]> = {};
  const conn = node.customFieldValues as
    { nodes?: Array<{ value: unknown; customField?: { id?: string } }> } | undefined;
  for (const v of conn?.nodes ?? []) {
    const id = v.customField?.id;
    if (!id || !allowed.has(id) || v.value === null || v.value === undefined || v.value === "")
      continue;
    (out[id] ??= []).push(typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value));
  }
  return out;
}

const CF_VALUES = { $: { size: 40 }, nodes: { value: {}, customField: { id: {} } } };

export const SYNC_ENTITIES: SyncEntityDef[] = [
  {
    key: "custom_fields",
    label: "Custom field definitions",
    description: "Names, types, and options of Acton's JobTread custom fields.",
    kind: "core",
    catalogEntity: "customFields",
    table: "jt_custom_fields",
    sensitivity: "general",
    priority: 10,
    dependsOn: [],
    privacy: "Definitions only. Values are cached with the record they belong to.",
    usedFor: "Every report field (cf:/sem:), field access governance, business-name mapping.",
  },
  {
    key: "jobs",
    label: "Jobs",
    description: "Projects with location, customer name, projections, and custom field values.",
    kind: "core",
    catalogEntity: "jobs",
    table: "jt_jobs",
    sensitivity: "general",
    priority: 20,
    dependsOn: ["custom_fields"],
    privacy: "No contact emails or phones. Excluded custom fields are never cached.",
    usedFor: "Most reports, Global Search, Dexter answers.",
  },
  {
    key: "documents",
    label: "Financial documents",
    description: "Customer orders, invoices, vendor orders and bills — totals and dates only.",
    kind: "core",
    catalogEntity: "documents",
    table: "jt_documents",
    sensitivity: "financial",
    priority: 30,
    dependsOn: ["jobs"],
    privacy: "No line items or attachments.",
    usedFor: "Order price/cost, gross profit, commissions.",
  },
  {
    key: "catalog_models",
    label: "Product Library models",
    description: "Top-level catalog cost groups with JobTread's server-side cost/price totals.",
    kind: "core",
    catalogEntity: "costGroups",
    table: "jt_catalog_models",
    sensitivity: "financial",
    priority: 40,
    dependsOn: [],
    privacy: "Totals only.",
    usedFor: "Product Library, model comparison, pricing by location.",
  },
  {
    key: "cost_groups",
    label: "Cost groups",
    description:
      "Budget and catalog group hierarchy (model → section → option → items) with parent links.",
    kind: "paged",
    catalogEntity: "costGroups",
    table: "jt_cost_groups",
    sensitivity: "general",
    priority: 45,
    dependsOn: ["catalog_models"],
    privacy: "Group names, descriptions, and parent links only.",
    usedFor:
      "Linking cost items to their model, section, and option (e.g. Exterior Package Options).",
    connection: "costGroups",
    pageSize: 100,
    nodes: {
      id: {},
      name: {},
      description: {},
      quantity: {},
      parentCostGroup: rel,
      job: rel,
    },
    normalize: (n, ctx) => ({
      id: String(n.id),
      name: str(n.name),
      description: str(n.description)?.slice(0, 2000) ?? null,
      parent_id: relId(n.parentCostGroup),
      job_id: relId(n.job),
      quantity: num(n.quantity),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "cost_items",
    label: "Cost items",
    description: "Budget and catalog lines: quantity, unit cost, unit price, cost code and type.",
    kind: "paged",
    catalogEntity: "costItems",
    table: "jt_cost_items",
    sensitivity: "financial",
    priority: 50,
    dependsOn: ["jobs", "catalog_models", "cost_groups"],
    privacy: "Prices are stored exactly as JobTread returns them; blanks stay blank.",
    usedFor: "Line-item pricing, budget vs. actual, model pricing detail.",
    connection: "costItems",
    pageSize: 100,
    nodes: {
      id: {},
      name: {},
      description: {},
      quantity: {},
      unitCost: {},
      unitPrice: {},
      cost: {},
      price: {},
      isSelected: {},
      createdAt: {},
      costGroup: relNamed,
      job: rel,
      costCode: relNamed,
      costType: relNamed,
      unit: relNamed,
      organizationCostItem: rel,
      isTaxable: {},
    },
    normalize: (n, ctx) => ({
      id: String(n.id),
      scope: relId(n.job) ? "job" : "catalog",
      unit_name: relName(n.unit),
      source_cost_item_id: relId(n.organizationCostItem),
      is_taxable: bool(n.isTaxable),
      job_id: relId(n.job),
      cost_group_id: relId(n.costGroup),
      cost_group_name: relName(n.costGroup),
      name: str(n.name),
      description: str(n.description),
      quantity: num(n.quantity),
      unit_cost: num(n.unitCost),
      unit_price: num(n.unitPrice),
      cost: num(n.cost),
      price: num(n.price),
      is_selected: bool(n.isSelected),
      cost_code_id: relId(n.costCode),
      cost_code_name: relName(n.costCode),
      cost_type_id: relId(n.costType),
      cost_type_name: relName(n.costType),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "tasks",
    label: "Tasks & schedule",
    description: "Schedule tasks, milestone groups, and to-dos with dates and progress.",
    kind: "paged",
    catalogEntity: "tasks",
    table: "jt_tasks",
    sensitivity: "general",
    priority: 60,
    dependsOn: ["jobs"],
    privacy: "Task names, dates, and progress only.",
    usedFor: "Milestone timelines, schedule slippage, workload.",
    connection: "tasks",
    pageSize: 100,
    nodes: {
      id: {},
      name: {},
      startDate: {},
      endDate: {},
      progress: {},
      completed: {},
      isGroup: {},
      isToDo: {},
      createdAt: {},
      job: rel,
    },
    normalize: (n, ctx) => ({
      id: String(n.id),
      job_id: relId(n.job),
      name: str(n.name),
      start_date: day(n.startDate),
      end_date: day(n.endDate),
      progress: num(n.progress),
      completed: num(n.completed),
      is_group: bool(n.isGroup),
      is_to_do: bool(n.isToDo),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "accounts",
    label: "Accounts (customers & vendors)",
    description: "Customer and vendor account names and types, plus allowed custom fields.",
    kind: "paged",
    catalogEntity: "accounts",
    table: "jt_accounts",
    sensitivity: "customer",
    priority: 70,
    dependsOn: ["custom_fields"],
    privacy: "No contact details. Only custom fields an admin allowed (not excluded).",
    usedFor: "Vendor reports, customer rollups.",
    connection: "accounts",
    pageSize: 100,
    nodes: { id: {}, name: {}, type: {}, createdAt: {}, customFieldValues: CF_VALUES },
    normalize: (n, ctx) => ({
      id: String(n.id),
      name: str(n.name),
      type: str(n.type),
      fields: allowedValues(n, ["customer", "vendor"], ctx),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "users",
    label: "JobTread users",
    description: "Organization members (names and roles) for assignee and author lookups.",
    kind: "paged",
    catalogEntity: "memberships",
    table: "jt_users",
    sensitivity: "internal",
    priority: 80,
    dependsOn: [],
    privacy: "Names and role names only — no emails, logins, or permissions.",
    usedFor: "Daily-log and time-entry authors, workload by person.",
    connection: "memberships",
    pageSize: 100,
    nodes: { id: {}, createdAt: {}, user: relNamed, role: relNamed },
    normalize: (n, ctx) => ({
      id: String(n.id),
      user_id: relId(n.user),
      name: relName(n.user),
      role_name: relName(n.role),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "contacts",
    label: "Contacts",
    description: "People on customer and vendor accounts — names and titles only.",
    kind: "paged",
    catalogEntity: "contacts",
    table: "jt_contacts",
    sensitivity: "customer",
    priority: 90,
    dependsOn: ["accounts"],
    privacy: "Emails and phone numbers are never requested from JobTread.",
    usedFor: "Decision-maker and vendor-contact lookups.",
    connection: "contacts",
    pageSize: 100,
    nodes: {
      id: {},
      name: {},
      title: {},
      createdAt: {},
      account: rel,
      customFieldValues: CF_VALUES,
    },
    normalize: (n, ctx) => ({
      id: String(n.id),
      account_id: relId(n.account),
      name: str(n.name),
      title: str(n.title),
      fields: allowedValues(n, ["contact"], ctx),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "daily_logs",
    label: "Daily logs",
    description: "Field daily logs: date, author, and notes.",
    kind: "paged",
    catalogEntity: "dailyLogs",
    table: "jt_daily_logs",
    sensitivity: "internal",
    priority: 100,
    dependsOn: ["jobs", "users"],
    privacy: "Notes are free text and may mention customers; photos are never synced.",
    usedFor: "Field activity and site-visit reports.",
    connection: "dailyLogs",
    pageSize: 50,
    nodes: { id: {}, date: {}, notes: {}, createdAt: {}, job: rel, user: rel },
    normalize: (n, ctx) => ({
      id: String(n.id),
      job_id: relId(n.job),
      user_id: relId(n.user),
      log_date: day(n.date),
      notes: str(n.notes)?.slice(0, 4000) ?? null,
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "files",
    label: "File metadata",
    description: "Names, folders, types, and sizes of job files (plans, permits, photos).",
    kind: "paged",
    catalogEntity: "files",
    table: "jt_files",
    sensitivity: "general",
    priority: 110,
    dependsOn: ["jobs"],
    privacy: "Metadata only — no file contents or download URLs.",
    usedFor: "Document completeness (e.g. has an approved site plan).",
    connection: "files",
    pageSize: 100,
    nodes: { id: {}, name: {}, folder: {}, type: {}, size: {}, createdAt: {}, job: rel },
    normalize: (n, ctx) => ({
      id: String(n.id),
      job_id: relId(n.job),
      name: str(n.name),
      folder: str(n.folder),
      content_type: str(n.type),
      size_bytes: num(n.size),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "payments",
    label: "Payments",
    description: "Customer payment amounts and dates.",
    kind: "paged",
    catalogEntity: "payments",
    table: "jt_payments",
    sensitivity: "financial",
    priority: 120,
    dependsOn: ["documents"],
    privacy: "Amounts and dates only — no payment methods or account numbers.",
    usedFor: "Cash collected, commission payment dates.",
    connection: "payments",
    pageSize: 100,
    nodes: { id: {}, amount: {}, date: {}, createdAt: {}, document: rel, job: rel },
    normalize: (n, ctx) => ({
      id: String(n.id),
      job_id: relId(n.job),
      document_id: relId(n.document),
      amount: num(n.amount),
      paid_on: day(n.date),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
  {
    key: "time_entries",
    label: "Time entries",
    description: "Hours logged against jobs (design hours, labor).",
    kind: "paged",
    catalogEntity: "timeEntries",
    table: "jt_time_entries",
    sensitivity: "internal",
    priority: 130,
    dependsOn: ["jobs", "users"],
    privacy: "Durations and cost codes only — no pay rates.",
    usedFor: "Design hours, labor by job.",
    connection: "timeEntries",
    pageSize: 100,
    nodes: {
      id: {},
      startedAt: {},
      endedAt: {},
      minutes: {},
      createdAt: {},
      job: rel,
      user: rel,
      costCode: relNamed,
    },
    normalize: (n, ctx) => ({
      id: String(n.id),
      job_id: relId(n.job),
      user_id: relId(n.user),
      started_at: str(n.startedAt),
      ended_at: str(n.endedAt),
      minutes: num(n.minutes),
      cost_code_name: relName(n.costCode),
      source_created_at: str(n.createdAt),
      synced_at: ctx.syncedAt,
      removed_at: null,
    }),
  },
];

/** Shipped enabled/disabled defaults (mirrors the 075 seed). Sensitive entities start off. */
export const DEFAULT_ENABLED = new Set<SyncEntityKey>([
  "custom_fields",
  "jobs",
  "documents",
  "catalog_models",
  "cost_groups",
  "cost_items",
  "tasks",
  "accounts",
  "users",
]);

export function getSyncEntity(key: string): SyncEntityDef | null {
  return SYNC_ENTITIES.find((d) => d.key === key) ?? null;
}

export function isSyncEntityKey(key: string): key is SyncEntityKey {
  return (SYNC_ENTITY_KEYS as readonly string[]).includes(key);
}

/** Order entities so every dependency in the set runs first (ties by priority). */
export function orderByDependencies(keys: SyncEntityKey[]): SyncEntityKey[] {
  const wanted = new Set(keys);
  const out: SyncEntityKey[] = [];
  const visit = (key: SyncEntityKey, path: Set<SyncEntityKey>) => {
    if (out.includes(key) || path.has(key)) return;
    path.add(key);
    const def = getSyncEntity(key)!;
    for (const dep of [...def.dependsOn].sort(byPriority)) if (wanted.has(dep)) visit(dep, path);
    out.push(key);
  };
  for (const key of [...wanted].sort(byPriority)) visit(key, new Set());
  return out;
}

function byPriority(a: SyncEntityKey, b: SyncEntityKey) {
  return (getSyncEntity(a)?.priority ?? 999) - (getSyncEntity(b)?.priority ?? 999);
}

/** Drop fields JobTread said don't exist for this grant. */
export function pruneNodes(nodes: Record<string, unknown>, dropped: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nodes)) if (!dropped.includes(k)) out[k] = v;
  return out;
}
