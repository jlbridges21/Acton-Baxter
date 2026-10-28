/**
 * JobTread-native field catalog: every discovered custom field (all JobTread entities) and
 * Baxter's standard fields, identified by immutable id (cf:<id>; source ref
 * jobtread:<organization>:<entity>:<id>) and shown with JobTread's current label.
 *
 * Catalog visibility is separate from permission to use values:
 *   - administrators see every field, including excluded and unsupported ones, with why
 *   - everyone else sees only reportable fields in categories their access allows; excluded
 *     and unsupported fields (and their labels) are not revealed
 * Metadata comes from the background refresh (jt_custom_fields); nothing here calls JobTread.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { analyzeAliases, type AliasFinding } from "@/lib/jobtread/alias-audit";
import {
  catalogSchemaReady,
  currentOrganizationId,
  fieldSourceRef,
  listCustomFields,
  listSemanticFields,
  type CustomFieldRow,
} from "@/lib/jobtread/metadata";
import { canSeeField, type ReportsAccess } from "./access";
import {
  COMMISSION_FIELDS,
  ITEM_FIELDS,
  JOB_BUILTINS,
  JOB_FINANCIAL_FIELDS,
  MODEL_FIELDS,
  type FieldDef,
} from "./fields";

/** JobTread entities whose custom-field values are in report data today. */
export const REPORTABLE_ENTITIES = new Set(["job", "location", "customer"]);

const ENTITY_ALIASES: Record<string, string> = {
  job: "job",
  jobs: "job",
  project: "job",
  projects: "job",
  location: "location",
  locations: "location",
  site: "location",
  customer: "customer",
  customers: "customer",
  account: "customer",
  accounts: "customer",
  customeraccount: "customer",
  customeraccounts: "customer",
  contact: "customerContact",
  contacts: "customerContact",
  customercontact: "customerContact",
  customercontacts: "customerContact",
  vendor: "vendor",
  vendors: "vendor",
  vendoraccount: "vendor",
  vendoraccounts: "vendor",
  vendorcontact: "vendorContact",
  vendorcontacts: "vendorContact",
  dailylog: "dailyLog",
  dailylogs: "dailyLog",
  costitem: "costItem",
  costitems: "costItem",
};

/** Canonical JobTread entity (targetType) for a loosely written name, or null. */
export function canonicalEntity(input: string | null | undefined): string | null {
  if (!input) return null;
  return ENTITY_ALIASES[input.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

export const ENTITY_LABELS: Record<string, string> = {
  job: "Jobs",
  location: "Locations",
  customer: "Customers",
  customerContact: "Customer contacts",
  vendor: "Vendors",
  vendorContact: "Vendor contacts",
  dailyLog: "Daily logs",
  costItem: "Cost items",
};

export type FieldStatus = "active" | "stale" | "excluded" | "unsupported";

export type NativeField = {
  ref: string;
  sourceRef: string | null;
  id: string | null;
  entity: string;
  label: string;
  jobtreadName: string | null;
  type: string;
  category: FieldDef["category"] | "excluded";
  status: FieldStatus;
  statusReason: string | null;
  kind: "custom" | "standard";
  aliases: string[];
  renamedFrom: string[];
  duplicateLabel: boolean;
  typeChange: { from: string; at: string } | null;
  removedAt: string | null;
  lastSeenAt: string | null;
};

type HistoryRow = {
  field_id: string;
  change: string;
  old_value: { name?: string } | null;
  new_value: { name?: string } | null;
  observed_at: string;
};

async function history(): Promise<HistoryRow[]> {
  if (!(await catalogSchemaReady())) return [];
  return agentDb()
    .select<HistoryRow>("jt_custom_field_history", {
      filters: [eq("organization_id", currentOrganizationId())],
      order: { col: "observed_at", ascending: false },
      limit: 5000,
    })
    .catch(() => []);
}

export async function lastCatalogRefresh() {
  if (!(await catalogSchemaReady())) return null;
  const [row] = await agentDb()
    .select<{
      id: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      seen: number;
      added: number;
      renamed: number;
      type_changed: number;
      removed: number;
      restored: number;
      held_removals: number;
      error: string | null;
    }>("jt_field_catalog_refreshes", {
      filters: [eq("organization_id", currentOrganizationId())],
      order: { col: "started_at", ascending: false },
      limit: 1,
    })
    .catch(() => []);
  return row ?? null;
}

function statusOf(f: CustomFieldRow): { status: FieldStatus; reason: string | null } {
  if (f.removed_at)
    return { status: "stale", reason: `Removed from JobTread on ${f.removed_at.slice(0, 10)}.` };
  if (!REPORTABLE_ENTITIES.has(f.target_type))
    return {
      status: "unsupported",
      reason: `${ENTITY_LABELS[f.target_type] ?? f.target_type} field values aren't in report data (no report source for this entity yet).`,
    };
  if (f.category === "excluded")
    return { status: "excluded", reason: "Excluded from reports by an administrator." };
  return { status: "active", reason: null };
}

const STANDARD: Array<{ entity: string; fields: FieldDef[] }> = [
  { entity: "job", fields: [...JOB_BUILTINS, ...JOB_FINANCIAL_FIELDS] },
  { entity: "catalogModel", fields: MODEL_FIELDS },
  { entity: "costItem", fields: ITEM_FIELDS },
  { entity: "commission", fields: COMMISSION_FIELDS },
];

/** The whole catalog (custom + standard) with alias findings. Filtered for the viewer. */
export async function loadNativeCatalog(access: ReportsAccess): Promise<{
  fields: NativeField[];
  aliases: Map<string, AliasFinding>;
}> {
  const [custom, aliases, hist] = await Promise.all([
    listCustomFields({ includeRemoved: true }),
    listSemanticFields(),
    history(),
  ]);
  const findings = analyzeAliases(aliases, custom);
  const aliasByTarget = new Map<string, string[]>();
  for (const a of aliases)
    if (a.custom_field_id && !(a as { archived_at?: string | null }).archived_at)
      aliasByTarget.set(a.custom_field_id, [
        ...(aliasByTarget.get(a.custom_field_id) ?? []),
        `sem:${a.key}`,
      ]);
  const renames = new Map<string, string[]>();
  for (const h of hist)
    if (h.change === "renamed" && h.old_value?.name)
      renames.set(h.field_id, [...(renames.get(h.field_id) ?? []), h.old_value.name]);
  const labelCount = new Map<string, number>();
  for (const f of custom.filter((x) => !x.removed_at)) {
    const k = `${f.target_type}|${(f.display_name || f.name).trim().toLowerCase()}`;
    labelCount.set(k, (labelCount.get(k) ?? 0) + 1);
  }
  const admin = access.isAdmin || access.canManage;
  const fields: NativeField[] = [];
  for (const f of custom) {
    const { status, reason } = statusOf(f);
    const category = f.category;
    // Non-admins never see excluded/unsupported fields (not even their labels) or fields in
    // categories they can't access.
    if (!admin) {
      if (status === "excluded" || status === "unsupported") continue;
      if (category !== "excluded" && !canSeeField(access, { category })) continue;
    }
    const label = f.display_name || f.name;
    fields.push({
      ref: `cf:${f.id}`,
      sourceRef: fieldSourceRef(f, f.organization_id),
      id: f.id,
      entity: f.target_type,
      label,
      jobtreadName: f.name,
      type: f.type,
      category,
      status,
      statusReason: reason,
      kind: "custom",
      aliases: aliasByTarget.get(f.id) ?? [],
      renamedFrom: renames.get(f.id) ?? [],
      duplicateLabel:
        !f.removed_at &&
        (labelCount.get(`${f.target_type}|${label.trim().toLowerCase()}`) ?? 0) > 1,
      typeChange:
        f.previous_type && f.type_changed_at
          ? { from: f.previous_type, at: f.type_changed_at }
          : null,
      removedAt: f.removed_at,
      lastSeenAt: f.last_seen_at,
    });
  }
  for (const group of STANDARD)
    for (const d of group.fields) {
      if (!admin && !canSeeField(access, d)) continue;
      fields.push({
        ref: d.key,
        sourceRef: null,
        id: null,
        entity: group.entity,
        label: d.label,
        jobtreadName: null,
        type: d.type,
        category: d.category,
        status: "active",
        statusReason: null,
        kind: "standard",
        aliases: [],
        renamedFrom: [],
        duplicateLabel: false,
        typeChange: null,
        removedAt: null,
        lastSeenAt: null,
      });
    }
  // Alias findings are admin information (they name fields that may be restricted).
  return { fields, aliases: admin ? findings : new Map() };
}

export async function searchNativeFields(
  access: ReportsAccess,
  q: {
    entity?: string;
    search?: string;
    status?: FieldStatus;
    type?: string;
    offset?: number;
    limit?: number;
  },
) {
  const { fields, aliases } = await loadNativeCatalog(access);
  const entity = q.entity ? (canonicalEntity(q.entity) ?? q.entity) : null;
  const needle = q.search?.trim().toLowerCase();
  const matches = fields.filter(
    (f) =>
      (!entity || f.entity === entity) &&
      (!q.status || f.status === q.status) &&
      (!q.type || f.type.toLowerCase() === q.type.toLowerCase()) &&
      (!needle ||
        f.label.toLowerCase().includes(needle) ||
        (f.jobtreadName ?? "").toLowerCase().includes(needle) ||
        f.ref.toLowerCase().includes(needle) ||
        (f.id ?? "").toLowerCase().includes(needle) ||
        f.renamedFrom.some((n) => n.toLowerCase().includes(needle)) ||
        f.aliases.some((a) => a.includes(needle))),
  );
  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 50, 200);
  const counts: Record<string, Record<FieldStatus | "total", number>> = {};
  for (const f of fields.filter((x) => x.kind === "custom")) {
    const c = (counts[f.entity] ??= { total: 0, active: 0, stale: 0, excluded: 0, unsupported: 0 });
    c.total++;
    c[f.status]++;
  }
  return {
    total: matches.length,
    offset,
    fields: matches.slice(offset, offset + limit),
    counts,
    aliases: [...aliases.values()],
  };
}
