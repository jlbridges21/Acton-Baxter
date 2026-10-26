/**
 * Business fields (jt_semantic_fields): the vocabulary reports and Dexter use ("Phase",
 * "Climate Zone", …), each mapped to one JobTread custom field by its stable id.
 *
 * - The requested list comes from JobTread_Custom_Fields.xlsx (business-field-requests.ts).
 *   It's imported once custom-field metadata has synced, so matches use real JobTread ids.
 * - Automatic mapping only on a *verified exact* match: same name (case/spacing aside), a
 *   JobTread target that fits the requested category, a compatible field type, and exactly
 *   one such field. Anything else stays unmapped for an administrator to review.
 * - Administrator choices (mapped_by = "admin", or an explicit "unmapped") are never changed
 *   by automation. Removing a field archives it, so reports referencing sem:<key> get a clear
 *   message instead of a dangling key.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  REQUESTED_BUSINESS_FIELDS,
  type RequestedBusinessField,
  type RequestedCategory,
} from "./business-field-requests";
import { listCustomFields, type CustomFieldRow, type SemanticFieldRow } from "./metadata";

export type BusinessFieldRow = SemanticFieldRow & {
  source?: "system" | "spreadsheet" | "admin";
  source_category?: string | null;
  source_name?: string | null;
  requested_target?: string | null;
  requested_type?: string | null;
  requested_options?: string[] | null;
  mapped_by?: "auto" | "admin" | null;
  sort_order?: number | null;
  archived_at?: string | null;
  created_at?: string;
};

/** Requested category → JobTread target types it may map to (normalized: lowercase letters). */
export const CATEGORY_TARGETS: Record<RequestedCategory, string[]> = {
  "Customer Accounts": ["customer", "customeraccount", "account"],
  "Customer Contacts": ["customercontact", "contact"],
  Locations: ["location"],
  Jobs: ["job"],
  "Cost Items": ["costitem"],
  "Daily Logs": ["dailylog"],
  "Vendor Accounts": ["vendor", "vendoraccount"],
  "Vendor Contacts": ["vendorcontact", "contact"],
};

/** Requested type → JobTread field types that hold the same kind of value. */
const TYPE_COMPAT: Record<string, string[]> = {
  dropdown: ["option", "select", "dropdown", "multiselect"],
  text: ["text", "textarea", "string", "longtext", "richtext"],
  number: ["number", "integer", "decimal", "currency"],
  email: ["emailaddress", "email"],
  phone: ["phonenumber", "phone"],
  url: ["url", "link"],
  date: ["date", "datetime"],
};

/** Targets whose values are cached with jobs and can be used in reports today. */
export const REPORTABLE_TARGETS = new Set(["job", "location", "customer"]);
/** Contact details are never synced into Baxter, whatever the mapping. */
const NEVER_SYNCED_TYPES = new Set(["emailaddress", "email", "phonenumber", "phone"]);

const letters = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
export const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function slugKey(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z]/.test(s) ? s : `f_${s}`.slice(0, 60);
}

export function targetFits(category: string | null | undefined, target: string): boolean {
  const allowed = CATEGORY_TARGETS[category as RequestedCategory];
  return allowed ? allowed.includes(letters(target)) : true;
}

export function typeFits(requested: string | null | undefined, actual: string): boolean {
  if (!requested) return true;
  const allowed = TYPE_COMPAT[letters(requested)];
  return allowed ? allowed.includes(letters(actual)) : true;
}

export type MatchResult =
  | { status: "exact"; field: CustomFieldRow }
  | { status: "ambiguous"; candidates: CustomFieldRow[] }
  | { status: "type_mismatch"; candidates: CustomFieldRow[] }
  | { status: "not_found"; candidates: CustomFieldRow[] };

/** Verified exact match for a requested field among active JobTread custom fields. */
export function matchRequested(
  req: { category: string; name: string; type: string | null },
  fields: CustomFieldRow[],
): MatchResult {
  const name = normalizeName(req.name);
  const sameName = fields.filter((f) => !f.removed_at && normalizeName(f.name) === name);
  const sameTarget = sameName.filter((f) => targetFits(req.category, f.target_type));
  const typed = sameTarget.filter((f) => typeFits(req.type, f.type));
  if (typed.length === 1) return { status: "exact", field: typed[0]! };
  if (typed.length > 1) return { status: "ambiguous", candidates: typed };
  if (sameTarget.length) return { status: "type_mismatch", candidates: sameTarget };
  return { status: "not_found", candidates: sameName };
}

export async function listBusinessFields(
  options: { includeArchived?: boolean } = {},
): Promise<BusinessFieldRow[]> {
  const rows = await agentDb().select<BusinessFieldRow>("jt_semantic_fields", { limit: 2000 });
  return rows
    .filter((r) => options.includeArchived || !r.archived_at)
    .map((r) => ({
      ...r,
      requested_options: Array.isArray(r.requested_options) ? r.requested_options : [],
    }));
}

/** Rows an administrator decided (mapping chosen or explicitly cleared). */
const adminTouched = (r: BusinessFieldRow) =>
  r.mapped_by === "admin" || (!r.custom_field_id && Boolean(r.updated_by));

/** Display label: names used by several categories get the category ("Email (Vendor Contacts)"). */
const DUPLICATE_NAMES = (() => {
  const counts = new Map<string, number>();
  for (const r of REQUESTED_BUSINESS_FIELDS)
    counts.set(normalizeName(r.name), (counts.get(normalizeName(r.name)) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
})();

export function requestedLabel(r: RequestedBusinessField): string {
  return DUPLICATE_NAMES.has(normalizeName(r.name)) ? `${r.name} (${r.category})` : r.name;
}

function requestedKey(r: RequestedBusinessField): string {
  return DUPLICATE_NAMES.has(normalizeName(r.name))
    ? slugKey(`${r.category} ${r.name}`)
    : slugKey(r.name);
}

/** An existing row that already represents this requested field (so it isn't duplicated). */
function findExisting(
  req: RequestedBusinessField,
  rows: BusinessFieldRow[],
  match: MatchResult,
  byId: Map<string, CustomFieldRow>,
): BusinessFieldRow | null {
  const same = rows.find((r) => r.source_category === req.category && r.source_name === req.name);
  if (same) return same;
  const free = rows.filter((r) => !r.source_name && !r.archived_at);
  const compatible = (r: BusinessFieldRow) => {
    const cf = r.custom_field_id ? byId.get(r.custom_field_id) : null;
    return !cf || targetFits(req.category, cf.target_type);
  };
  const label = normalizeName(requestedLabel(req));
  const byLabel = free.find(
    (r) => (normalizeName(r.label) === label || r.key === requestedKey(req)) && compatible(r),
  );
  if (byLabel) return byLabel;
  // A shipped default auto-mapped to this exact field earlier (e.g. "Model" → "Model & Series").
  if (match.status === "exact") {
    const mapped = rows.filter((r) => !r.archived_at && r.custom_field_id === match.field.id);
    if (mapped.length === 1 && !mapped[0]!.source_name && mapped[0]!.mapped_by !== "admin")
      return mapped[0]!;
  }
  return null;
}

export type ImportSummary = {
  skipped?: "fields_not_synced";
  requested: number;
  created: number;
  linked: number;
  autoMapped: number;
  unmapped: number;
};

/**
 * Import the spreadsheet list (idempotent). Requires synced JobTread field metadata so
 * matches use real ids. Existing rows and administrator mappings are preserved.
 */
export async function importRequestedBusinessFields(): Promise<ImportSummary> {
  const summary: ImportSummary = {
    requested: REQUESTED_BUSINESS_FIELDS.length,
    created: 0,
    linked: 0,
    autoMapped: 0,
    unmapped: 0,
  };
  const fields = await listCustomFields();
  if (!fields.length) return { ...summary, skipped: "fields_not_synced" };
  const byId = new Map(fields.map((f) => [f.id, f]));
  const db = agentDb();
  const rows = await listBusinessFields({ includeArchived: true });
  const keys = new Set(rows.map((r) => r.key));
  const now = new Date().toISOString();
  for (const [i, req] of REQUESTED_BUSINESS_FIELDS.entries()) {
    const match = matchRequested(req, fields);
    const target = CATEGORY_TARGETS[req.category][0]!;
    const requested = {
      source_category: req.category,
      source_name: req.name,
      requested_target: target,
      requested_type: req.type,
      requested_options: req.options,
      sort_order: i,
    };
    const existing = findExisting(req, rows, match, byId);
    if (existing) {
      const autoMap =
        !existing.custom_field_id && !adminTouched(existing) && match.status === "exact";
      if (!existing.source_name) summary.linked++;
      const patch: Partial<BusinessFieldRow> = existing.source_name ? {} : requested;
      if (autoMap) Object.assign(patch, { custom_field_id: match.field.id, mapped_by: "auto" });
      if (Object.keys(patch).length) {
        await db.update("jt_semantic_fields", [eq("key", existing.key)], patch);
        Object.assign(existing, patch);
      }
      if (autoMap) summary.autoMapped++;
      if (!existing.custom_field_id) summary.unmapped++;
      continue;
    }
    let key = requestedKey(req);
    for (let n = 2; keys.has(key); n++) key = `${requestedKey(req).slice(0, 56)}_${n}`;
    keys.add(key);
    const row: BusinessFieldRow = {
      key,
      label: requestedLabel(req),
      description: null,
      custom_field_id: match.status === "exact" ? match.field.id : null,
      mapped_by: match.status === "exact" ? "auto" : null,
      updated_by: null,
      updated_at: now,
      source: "spreadsheet",
      ...requested,
    };
    await db.insert("jt_semantic_fields", row);
    rows.push(row);
    summary.created++;
    if (row.custom_field_id) summary.autoMapped++;
    else summary.unmapped++;
  }
  return summary;
}

/** After a metadata sync: auto-map rows that are still unmapped and untouched by an admin. */
export async function reconcileAutoMappings(): Promise<number> {
  const fields = await listCustomFields();
  if (!fields.length) return 0;
  let mapped = 0;
  for (const r of await listBusinessFields()) {
    if (r.custom_field_id || adminTouched(r) || !r.source_name || !r.source_category) continue;
    const m = matchRequested(
      { category: r.source_category, name: r.source_name, type: r.requested_type ?? null },
      fields,
    );
    if (m.status !== "exact") continue;
    await agentDb().update("jt_semantic_fields", [eq("key", r.key)], {
      custom_field_id: m.field.id,
      mapped_by: "auto",
    });
    mapped++;
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Status (what the admin UI flags and what Dexter is told)
// ---------------------------------------------------------------------------

export type BusinessFieldStatus =
  | "mapped"
  | "mapped_not_reportable"
  | "needs_review"
  | "unmapped"
  | "not_in_jobtread"
  | "invalid"
  | "mismatch"
  | "excluded"
  | "archived";

export type BusinessFieldView = {
  key: string;
  label: string;
  description: string | null;
  source: string;
  sourceCategory: string | null;
  sourceName: string | null;
  requestedTarget: string | null;
  requestedType: string | null;
  requestedOptions: string[];
  customFieldId: string | null;
  mappedBy: string | null;
  mapped: {
    id: string;
    name: string;
    target: string;
    type: string;
    category: string;
    removed: boolean;
  } | null;
  status: BusinessFieldStatus;
  level: "ok" | "info" | "warning" | "error";
  issues: string[];
  candidates: Array<{ id: string; name: string; target: string; type: string }>;
  sharedWith: string[];
  usedByReports: number;
  archivedAt: string | null;
  updatedAt: string;
};

export function describeBusinessField(
  r: BusinessFieldRow,
  fields: CustomFieldRow[],
  allRows: BusinessFieldRow[],
  usage: Map<string, number>,
): BusinessFieldView {
  const all = new Map(fields.map((f) => [f.id, f]));
  const cf = r.custom_field_id ? (all.get(r.custom_field_id) ?? null) : null;
  const issues: string[] = [];
  let status: BusinessFieldStatus = "mapped";
  let candidates: CustomFieldRow[] = [];
  const match =
    r.source_name && r.source_category
      ? matchRequested(
          { category: r.source_category, name: r.source_name, type: r.requested_type ?? null },
          fields,
        )
      : null;
  if (r.archived_at) {
    status = "archived";
    issues.push("Removed from the list. Reports that still use it show it as unavailable.");
  } else if (!r.custom_field_id) {
    candidates =
      match?.status === "ambiguous" || match?.status === "type_mismatch"
        ? match.candidates
        : match?.status === "exact"
          ? [match.field]
          : (match?.candidates ?? []);
    if (match?.status === "ambiguous") {
      status = "needs_review";
      issues.push(`${candidates.length} JobTread fields have this name — choose the right one.`);
    } else if (match?.status === "type_mismatch") {
      status = "needs_review";
      issues.push(
        `A JobTread field has this name but a different type (${candidates.map((c) => c.type).join(", ")} vs. ${r.requested_type}). Confirm before mapping.`,
      );
    } else if (match?.status === "exact") {
      status = "needs_review";
      issues.push(
        adminTouched(r)
          ? "An exact match exists but an administrator left this unmapped."
          : `Verified exact match available: "${match.field.name}" (${match.field.target_type}). Use “Map verified matches”.`,
      );
    } else if (match) {
      status = "not_in_jobtread";
      issues.push(
        fields.length
          ? `No ${r.source_category} field named "${r.source_name}" exists in JobTread.`
          : "JobTread fields haven't been synced yet.",
      );
    } else {
      status = "unmapped";
      issues.push(r.description || "Not mapped to a JobTread field.");
    }
  } else if (!cf || cf.removed_at) {
    status = "invalid";
    issues.push(
      cf
        ? `The mapped JobTread field "${cf.name}" was removed from JobTread.`
        : `The mapped JobTread field (${r.custom_field_id}) doesn't exist. Run a sync or remap.`,
    );
  } else {
    if (r.source_category && !targetFits(r.source_category, cf.target_type)) {
      status = "mismatch";
      issues.push(`Requested as ${r.source_category}, but mapped to a ${cf.target_type} field.`);
    }
    if (r.requested_type && !typeFits(r.requested_type, cf.type)) {
      status = "mismatch";
      issues.push(`Requested type ${r.requested_type}, but the JobTread field is ${cf.type}.`);
    }
    if (status === "mapped" && cf.category === "excluded") {
      status = "excluded";
      issues.push("The JobTread field is set to Excluded, so reports and Dexter can't use it.");
    }
    if (status === "mapped" && NEVER_SYNCED_TYPES.has(letters(cf.type))) {
      status = "mapped_not_reportable";
      issues.push("Contact details (emails, phones) are never synced into Baxter.");
    } else if (status === "mapped" && !REPORTABLE_TARGETS.has(cf.target_type)) {
      status = "mapped_not_reportable";
      issues.push(
        `Mapped, but ${cf.target_type} field values aren't in report data yet (only job, location, and customer fields are).`,
      );
    }
  }
  const sharedWith = r.custom_field_id
    ? allRows
        .filter((o) => o.key !== r.key && !o.archived_at && o.custom_field_id === r.custom_field_id)
        .map((o) => o.label)
    : [];
  if (sharedWith.length && !r.archived_at)
    issues.push(`Shares its JobTread field with ${sharedWith.join(", ")}.`);
  const level: BusinessFieldView["level"] =
    status === "invalid" || status === "mismatch"
      ? "error"
      : status === "mapped"
        ? sharedWith.length
          ? "info"
          : "ok"
        : status === "archived" || status === "mapped_not_reportable"
          ? "info"
          : "warning";
  return {
    key: r.key,
    label: r.label,
    description: r.description,
    source: r.source ?? "system",
    sourceCategory: r.source_category ?? null,
    sourceName: r.source_name ?? null,
    requestedTarget: r.requested_target ?? null,
    requestedType: r.requested_type ?? null,
    requestedOptions: r.requested_options ?? [],
    customFieldId: r.custom_field_id,
    mappedBy: r.mapped_by ?? (r.custom_field_id ? (r.updated_by ? "admin" : "auto") : null),
    mapped: cf
      ? {
          id: cf.id,
          name: cf.name,
          target: cf.target_type,
          type: cf.type,
          category: cf.category,
          removed: Boolean(cf.removed_at),
        }
      : null,
    status,
    level,
    issues,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      target: c.target_type,
      type: c.type,
    })),
    sharedWith,
    usedByReports: usage.get(r.key) ?? 0,
    archivedAt: r.archived_at ?? null,
    updatedAt: r.updated_at,
  };
}

/** sem:<key> → number of reports (including templates) that reference it. */
async function businessFieldUsage(): Promise<Map<string, number>> {
  const { collectFieldRefs, parseReportSpec } = await import("@/lib/reports/spec");
  const reports = await agentDb()
    .select<{ spec: unknown; status: string }>("bi_reports", { limit: 5000 })
    .catch(() => []);
  const usage = new Map<string, number>();
  for (const r of reports) {
    if (r.status === "archived") continue;
    const parsed = parseReportSpec(r.spec);
    if (!parsed.ok) continue;
    for (const ref of new Set(collectFieldRefs(parsed.spec)))
      if (ref.startsWith("sem:")) usage.set(ref.slice(4), (usage.get(ref.slice(4)) ?? 0) + 1);
  }
  return usage;
}

export async function getBusinessFieldsOverview() {
  const [rows, fields, usage] = await Promise.all([
    listBusinessFields({ includeArchived: true }),
    listCustomFields({ includeRemoved: true }),
    businessFieldUsage(),
  ]);
  const active = fields.filter((f) => !f.removed_at);
  const views = rows
    .map((r) => describeBusinessField(r, fields, rows, usage))
    .sort(
      (a, b) =>
        Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) ||
        a.label.localeCompare(b.label),
    );
  const live = views.filter((v) => !v.archivedAt);
  const count = (s: BusinessFieldStatus[]) => live.filter((v) => s.includes(v.status)).length;
  const requestedImported = new Set(
    rows.filter((r) => r.source_name).map((r) => `${r.source_category}|${r.source_name}`),
  );
  return {
    fieldsSynced: active.length > 0,
    summary: {
      total: live.length,
      mapped: count(["mapped"]),
      mappedNotReportable: count(["mapped_not_reportable"]),
      needsReview: count(["needs_review", "unmapped"]),
      notInJobTread: count(["not_in_jobtread"]),
      invalid: count(["invalid", "mismatch", "excluded"]),
      archived: views.length - live.length,
      spreadsheetRequested: REQUESTED_BUSINESS_FIELDS.length,
      spreadsheetImported: REQUESTED_BUSINESS_FIELDS.filter((r) =>
        requestedImported.has(`${r.category}|${r.name}`),
      ).length,
    },
    fields: views,
    jobtreadFields: active
      .map((f) => ({
        id: f.id,
        name: f.name,
        target: f.target_type,
        type: f.type,
        category: f.category,
        reportable: REPORTABLE_TARGETS.has(f.target_type),
      }))
      .sort((a, b) => a.target.localeCompare(b.target) || a.name.localeCompare(b.name)),
    categories: Object.keys(CATEGORY_TARGETS),
  };
}

// ---------------------------------------------------------------------------
// Admin edits
// ---------------------------------------------------------------------------

async function requireRow(key: string): Promise<BusinessFieldRow> {
  const [row] = await agentDb().select<BusinessFieldRow>("jt_semantic_fields", {
    filters: [eq("key", key)],
    limit: 1,
  });
  if (!row) throw new NotFoundError("That business field doesn't exist.");
  return row;
}

async function assertFieldExists(customFieldId: string | null | undefined) {
  if (!customFieldId) return;
  const fields = await listCustomFields();
  if (!fields.some((f) => f.id === customFieldId))
    throw new ValidationError("That JobTread field wasn't found. Run a sync first.");
}

export async function createBusinessField(
  input: {
    label: string;
    description?: string | null;
    category?: string | null;
    type?: string | null;
    customFieldId?: string | null;
  },
  userId: string,
): Promise<BusinessFieldRow> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Enter a name.");
  const rows = await listBusinessFields({ includeArchived: true });
  if (rows.some((r) => !r.archived_at && normalizeName(r.label) === normalizeName(label)))
    throw new ValidationError(`A business field named "${label}" already exists.`);
  await assertFieldExists(input.customFieldId);
  const keys = new Set(rows.map((r) => r.key));
  let key = slugKey(label);
  for (let n = 2; keys.has(key); n++) key = `${slugKey(label).slice(0, 56)}_${n}`;
  const category = input.category && input.category in CATEGORY_TARGETS ? input.category : null;
  const row: BusinessFieldRow = {
    key,
    label: label.slice(0, 120),
    description: input.description?.trim() || null,
    custom_field_id: input.customFieldId ?? null,
    mapped_by: input.customFieldId ? "admin" : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    source: "admin",
    source_category: category,
    source_name: category ? label : null,
    requested_target: category ? CATEGORY_TARGETS[category as RequestedCategory][0]! : null,
    requested_type: input.type ?? null,
    requested_options: [],
  };
  await agentDb().insert("jt_semantic_fields", row);
  return row;
}

export async function updateBusinessField(
  key: string,
  patch: {
    label?: string;
    description?: string | null;
    customFieldId?: string | null;
  },
  userId: string,
): Promise<BusinessFieldRow> {
  const row = await requireRow(key);
  const next: Partial<BusinessFieldRow> = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new ValidationError("Enter a name.");
    const rows = await listBusinessFields();
    if (rows.some((r) => r.key !== key && normalizeName(r.label) === normalizeName(label)))
      throw new ValidationError(`A business field named "${label}" already exists.`);
    next.label = label.slice(0, 120);
  }
  if (patch.description !== undefined) next.description = patch.description?.trim() || null;
  if (patch.customFieldId !== undefined) {
    await assertFieldExists(patch.customFieldId);
    next.custom_field_id = patch.customFieldId;
    // An explicit choice — including "unmapped" — is an administrator decision.
    next.mapped_by = patch.customFieldId ? "admin" : null;
  }
  await agentDb().update("jt_semantic_fields", [eq("key", row.key)], next);
  return { ...row, ...next };
}

/** Archive (never hard-delete): the key stays reserved so reports get a clear message. */
export async function setBusinessFieldArchived(
  key: string,
  archived: boolean,
  userId: string,
): Promise<void> {
  await requireRow(key);
  await agentDb().update("jt_semantic_fields", [eq("key", key)], {
    archived_at: archived ? new Date().toISOString() : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
}
