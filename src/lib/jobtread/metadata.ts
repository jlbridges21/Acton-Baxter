/**
 * JobTread custom-field metadata: discovery, default access categories, and the
 * business-vocabulary mapping ("Recommended BR Model" → a specific field id).
 *
 * Field ids are the stable keys. Names can change in JobTread; admin edits
 * (display name, description, category) are never overwritten by discovery.
 */

import "server-only";

import { agentDb, eq, type Filter } from "@/lib/agents/store";
import { paginate, type PaveStats } from "./client";

export type FieldCategory = "general" | "customer" | "financial" | "internal" | "excluded";

export type CustomFieldRow = {
  id: string;
  name: string;
  type: string;
  target_type: string;
  options: string[];
  position: string | null;
  display_name: string | null;
  description: string | null;
  category: FieldCategory;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
};

export type SemanticFieldRow = {
  key: string;
  label: string;
  description: string | null;
  custom_field_id: string | null;
  updated_by: string | null;
  updated_at: string;
};

/** Targets Reports caches. Contacts, vendors, cost items, and daily logs are not synced. */
export const SYNCED_TARGETS = new Set(["job", "location", "customer"]);

const CUSTOMER_GENERAL = new Set([
  "recommended br models",
  "customer priorities & must-haves",
  "scope clarifications",
  "project purpose",
  "customer goals",
]);
const CUSTOMER_INTERNAL = new Set([
  "internal strategy notes",
  "customer personality & involvement",
  "customer decision dynamics",
  "customer concerns & fears",
  "decision makers",
  "sales commitments & assumptions",
]);

/** Conservative defaults for newly discovered fields; admins can change them. */
export function defaultCategory(field: {
  name: string;
  target_type: string;
  type: string;
}): FieldCategory {
  const name = field.name.trim().toLowerCase();
  if (!SYNCED_TARGETS.has(field.target_type)) return "excluded";
  if (/\b(budget|price|cost|margin|revenue|payment|salary|pay)\b/.test(name)) return "financial";
  if (field.target_type === "customer") {
    if (CUSTOMER_GENERAL.has(name)) return "general";
    if (CUSTOMER_INTERNAL.has(name)) return "internal";
    return "customer";
  }
  if (["emailaddress", "phonenumber"].includes(field.type.toLowerCase())) return "customer";
  return "general";
}

/** Business vocabulary used by templates and Dexter. `match` auto-maps on first discovery. */
export const SEMANTIC_DEFAULTS: Array<{
  key: string;
  label: string;
  description?: string;
  match?: { target: string; name: string };
}> = [
  { key: "phase", label: "Phase", match: { target: "job", name: "Phase" } },
  { key: "status", label: "Status", match: { target: "job", name: "Status" } },
  { key: "job_type", label: "Job Type", match: { target: "job", name: "Job Type" } },
  { key: "model", label: "Model", match: { target: "job", name: "Model" } },
  { key: "total_sqft", label: "Square Footage", match: { target: "job", name: "Total Sqft" } },
  { key: "bed_bath", label: "Bed / Bath", match: { target: "job", name: "Bed / Bath Count" } },
  {
    key: "project_manager",
    label: "Project Manager",
    match: { target: "job", name: "Project Manager" },
  },
  {
    key: "design_coordinator",
    label: "Design Coordinator",
    match: { target: "job", name: "Design Coordinator" },
  },
  { key: "drafter", label: "Drafter", match: { target: "job", name: "Drafter" } },
  {
    key: "site_supervisor",
    label: "Site Supervisor",
    match: { target: "job", name: "Site Supervisor" },
  },
  { key: "sales_rep", label: "Sales Rep", match: { target: "job", name: "Sales Rep" } },
  {
    key: "feasibility_pm",
    label: "Feasibility Project Manager",
    match: { target: "job", name: "Feasibility Project Manager" },
  },
  { key: "permit_status", label: "Permit Status", match: { target: "job", name: "Permit Status" } },
  { key: "permit", label: "Permit", match: { target: "job", name: "Permit" } },
  { key: "contract_type", label: "Contract Type", match: { target: "job", name: "Contract Type" } },
  {
    key: "exterior_package",
    label: "Exterior Package",
    match: { target: "job", name: "Exterior Package" },
  },
  {
    key: "interior_package",
    label: "Interior Package",
    match: { target: "job", name: "Interior Package" },
  },
  {
    key: "design_handoff",
    label: "Design Handoff Notes",
    match: { target: "job", name: "Design Handoff" },
  },
  {
    key: "production_handoff",
    label: "Production Handoff Notes",
    match: { target: "job", name: "Production Handoff" },
  },
  {
    key: "feasibility_package",
    label: "Feasibility Package",
    match: { target: "job", name: "Feasibility Package" },
  },
  {
    key: "recommended_br_model",
    label: "Recommended BR Model",
    match: { target: "customer", name: "Recommended BR Models" },
  },
  {
    key: "must_have_features",
    label: "Must-Have Features",
    match: { target: "customer", name: "Customer Priorities & Must-Haves" },
  },
  {
    key: "accessibility_requirements",
    label: "Accessibility / Special Requirements",
    match: { target: "location", name: "Accessibility Requirement" },
  },
  {
    key: "site_constraints",
    label: "Site & Access Constraints",
    match: { target: "location", name: "Site & Access Constraints" },
  },
  {
    key: "city_zoning_feedback",
    label: "City / Zoning Feedback",
    match: { target: "location", name: "City / Zoning Feedback" },
  },
  {
    key: "special_permit_requirements",
    label: "Hazards / Special Permit Requirements",
    match: { target: "location", name: "Hazards, Reports, Reqs. Special Permit Req" },
  },
  { key: "zoning", label: "Zoning", match: { target: "location", name: "Zoning" } },
  {
    key: "climate_zone",
    label: "Climate Zone",
    match: { target: "location", name: "Climate Zone" },
  },
  { key: "wui_zone", label: "WUI Zone", match: { target: "location", name: "WUI Zone" } },
  { key: "apn", label: "APN", match: { target: "location", name: "APN" } },
  {
    key: "main_home_foundation",
    label: "Main Home Foundation",
    match: { target: "location", name: "Main Home Foundation" },
  },
  {
    key: "adu_foundation",
    label: "ADU Foundation",
    match: { target: "location", name: "ADU Foundation" },
  },
  { key: "electrical", label: "Electrical", match: { target: "location", name: "Electrical" } },
  {
    key: "main_panel_size",
    label: "Main Panel Size",
    match: { target: "location", name: "Main Panel Size" },
  },
  { key: "sewer", label: "Sewer", match: { target: "location", name: "Sewer" } },
  {
    key: "water_line_size",
    label: "Current Water Line Size",
    match: { target: "location", name: "Current Water Line Size" },
  },
  {
    key: "water_meter_size",
    label: "Current Water Meter Size",
    match: { target: "location", name: "Current Water Meter Size" },
  },
  {
    key: "soils_report",
    label: "Soils Report Required",
    match: { target: "location", name: "Soils Report" },
  },
  {
    key: "sprinklers_required",
    label: "Sprinklers Required",
    match: { target: "location", name: "Sprinklers Required" },
  },
  {
    key: "main_home_eave_projection",
    label: "Main Home Eave Projection",
    match: { target: "location", name: "Main Home Eave Projection" },
  },
  {
    key: "trench_length",
    label: "Total Trench Length",
    match: { target: "location", name: "Total Trench Length" },
  },
  // Requested by the Domo reports but not found in JobTread during discovery (2026-10-22).
  {
    key: "soil_utility_notes",
    label: "Soil / Utility Notes",
    description: "No free-text soil/utility notes field exists; see the individual utility fields.",
  },
  {
    key: "approved_site_plan",
    label: "Approved Site Plan",
    description: "Not a custom field in JobTread; site plans are stored as job files.",
  },
  {
    key: "design_hours",
    label: "Design Hours",
    description: "JobTread has no time entries for this organization yet.",
  },
  { key: "vault_height", label: "Vault Height", description: "Not found in JobTread." },
  {
    key: "floorplan",
    label: "Floorplan",
    description: "Not a custom field; floorplans are stored as job files.",
  },
];

export async function listCustomFields(options?: {
  includeRemoved?: boolean;
}): Promise<CustomFieldRow[]> {
  const filters: Filter[] = options?.includeRemoved ? [] : [{ col: "removed_at", op: "is_null" }];
  const rows = await agentDb().select<CustomFieldRow>("jt_custom_fields", {
    filters,
    order: { col: "position" },
  });
  return rows.map((r) => ({ ...r, options: Array.isArray(r.options) ? r.options : [] }));
}

export async function listSemanticFields(): Promise<SemanticFieldRow[]> {
  return agentDb().select<SemanticFieldRow>("jt_semantic_fields", { order: { col: "label" } });
}

type FieldNode = {
  id: string;
  name: string;
  type: string;
  targetType: string;
  options: string[] | null;
  position?: string;
};

/** Discover custom fields and upsert metadata (admin edits preserved). */
export async function syncCustomFieldMetadata(
  stats: PaveStats,
): Promise<{ seen: number; added: number; removed: number }> {
  const nodes = await paginate<FieldNode>({
    connection: "customFields",
    args: { sortBy: [{ field: "targetType" }, { field: "position" }] },
    nodes: { id: {}, name: {}, type: {}, targetType: {}, options: {}, position: {} },
    pageSize: 100,
    stats,
  });
  const db = agentDb();
  const existing = new Map(
    (await listCustomFields({ includeRemoved: true })).map((f) => [f.id, f]),
  );
  const now = new Date().toISOString();
  let added = 0;
  for (const n of nodes) {
    const prior = existing.get(n.id);
    const source = {
      name: n.name,
      type: n.type,
      target_type: n.targetType,
      options: n.options ?? [],
      position: n.position ?? null,
      last_seen_at: now,
      removed_at: null,
    };
    if (prior) {
      await db.update("jt_custom_fields", [eq("id", n.id)], source);
    } else {
      added++;
      await db.insert("jt_custom_fields", {
        id: n.id,
        ...source,
        category: defaultCategory({ name: n.name, target_type: n.targetType, type: n.type }),
        display_name: null,
        description: null,
        first_seen_at: now,
      });
    }
  }
  const seenIds = new Set(nodes.map((n) => n.id));
  let removed = 0;
  for (const prior of existing.values()) {
    if (!seenIds.has(prior.id) && !prior.removed_at) {
      removed++;
      await db.update("jt_custom_fields", [eq("id", prior.id)], { removed_at: now });
    }
  }
  await ensureSemanticDefaults();
  return { seen: nodes.length, added, removed };
}

/** Create missing vocabulary rows and auto-map unmapped ones by exact (target, name) match. */
export async function ensureSemanticDefaults(): Promise<void> {
  const db = agentDb();
  const fields = await listCustomFields();
  const current = new Map((await listSemanticFields()).map((s) => [s.key, s]));
  for (const def of SEMANTIC_DEFAULTS) {
    const match = def.match
      ? fields.find(
          (f) =>
            f.target_type === def.match!.target &&
            f.name.trim().toLowerCase() === def.match!.name.toLowerCase(),
        )
      : undefined;
    const prior = current.get(def.key);
    if (!prior) {
      await db.insert("jt_semantic_fields", {
        key: def.key,
        label: def.label,
        description: def.description ?? null,
        custom_field_id: match?.id ?? null,
        updated_by: null,
        updated_at: new Date().toISOString(),
      });
    } else if (!prior.custom_field_id && !prior.updated_by && match) {
      // Only auto-map rows no administrator has touched (an explicit "unmapped" sticks).
      await db.update("jt_semantic_fields", [eq("key", def.key)], { custom_field_id: match.id });
    }
  }
}

export async function updateCustomFieldSettings(
  id: string,
  patch: Partial<Pick<CustomFieldRow, "display_name" | "description" | "category">>,
): Promise<void> {
  await agentDb().update("jt_custom_fields", [eq("id", id)], patch);
}

export async function updateSemanticField(
  key: string,
  patch: { custom_field_id?: string | null; label?: string; description?: string | null },
  userId: string | null,
): Promise<void> {
  await agentDb().update("jt_semantic_fields", [eq("key", key)], {
    ...patch,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
}
