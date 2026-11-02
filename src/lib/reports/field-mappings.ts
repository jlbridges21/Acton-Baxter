/**
 * Field Mapping Health: loads metadata, sync state, and admin overrides, runs the pure
 * validator (field-mapping-core.ts), persists a snapshot (jt_field_mappings, migration 083),
 * and applies administrator actions (reporting on/off, review resolution, alias re-pointing).
 *
 * Guarantees
 *   - Keyed by JobTread field id (cf:<id>) and tenant (organization_id); names are display data.
 *   - Never deletes: snapshot rows are upserted; removed fields keep their row (stale).
 *   - Never re-points an alias on its own: ambiguous name-based mappings are flagged for review.
 *   - Turning a field off for reports keeps its synced values (unlike a Field access exclusion,
 *     which stops caching for privacy). Turning it on never widens access: the field's access
 *     category still applies to every viewer and every engine path.
 * Without migration 083 the validator still runs live; only toggles and snapshots need the table.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { recordAudit } from "@/lib/agents/audit";
import { ValidationError } from "@/lib/errors";
import { analyzeAliases } from "@/lib/jobtread/alias-audit";
import { lastSuccessfulSync } from "@/lib/jobtread/sync";
import { listBusinessFields } from "@/lib/jobtread/business-fields";
import {
  currentOrganizationId,
  listCustomFields,
  SEMANTIC_DEFAULTS,
  updateSemanticField,
} from "@/lib/jobtread/metadata";
import type { ReportsAccess } from "./access";
import {
  lookupField,
  validateFieldMappings,
  type AliasInput,
  type DatasetInput,
  type MappingOverride,
  type MappingResult,
  type ValidationReport,
} from "./field-mapping-core";

export const MAPPINGS_TABLE = "jt_field_mappings";
const CORE_DATASETS = new Set(["custom_fields", "jobs", "documents", "catalog_models"]);

type MappingRow = MappingOverride & {
  organization_id: string;
  mapping_kind: "field" | "alias";
  source_entity: string;
  field_id: string | null;
  mapping_status: string;
  sync_status: string;
  exclusion_reason: string | null;
  errors: unknown;
  updated_by?: string | null;
};

let schema: Promise<boolean> | null = null;
/** Migration 083 adds jt_field_mappings; detect once per process. */
export function mappingSchemaReady(): Promise<boolean> {
  schema ??= agentDb()
    .select(MAPPINGS_TABLE, { limit: 1 })
    .then(() => true)
    .catch(() => false);
  return schema;
}
export function resetMappingSchemaProbe() {
  schema = null;
}

async function loadOverrides(): Promise<MappingRow[]> {
  if (!(await mappingSchemaReady())) return [];
  return agentDb()
    .select<MappingRow>(MAPPINGS_TABLE, {
      filters: [eq("organization_id", currentOrganizationId())],
      limit: 5000,
    })
    .catch(() => []);
}

/** Refs an administrator turned off for reports (tenant-scoped). Used by the field catalog. */
export async function reportingDisabledRefs(): Promise<Set<string>> {
  const rows = await loadOverrides();
  return new Set(rows.filter((r) => r.reporting_enabled === false).map((r) => r.internal_ref));
}

async function loadDatasets(): Promise<DatasetInput[]> {
  const rows = await agentDb()
    .select<{
      entity: string;
      enabled: boolean;
      status: string;
      last_success_at: string | null;
      last_error: string | null;
      dropped_fields: unknown;
    }>("jt_sync_entities", { limit: 100 })
    .catch(() => []);
  // Core datasets (custom fields, jobs, …) are also refreshed by the full sync, which records
  // its success in jt_sync_runs — the same fallback the Data Health page uses.
  const legacy = rows.some((r) => CORE_DATASETS.has(r.entity) && !r.last_success_at)
    ? ((await lastSuccessfulSync().catch(() => null))?.finished_at ?? null)
    : null;
  return rows.map((r) => ({
    key: r.entity,
    enabled: r.enabled,
    status: r.status,
    lastSuccessAt: r.last_success_at ?? (CORE_DATASETS.has(r.entity) ? legacy : null),
    lastError: r.last_error,
    droppedFields: Array.isArray(r.dropped_fields) ? (r.dropped_fields as string[]) : [],
  }));
}

/** ref → number of reports (and metrics) whose spec mentions it. */
async function loadUsage(): Promise<Map<string, number>> {
  const { collectRefUses } = await import("./report-audit");
  const reports = await agentDb()
    .select<{ id: string; spec: unknown }>("bi_reports", { limit: 2000 })
    .catch(() => []);
  const usage = new Map<string, number>();
  for (const r of reports)
    for (const ref of new Set(collectRefUses(r.spec).map((u) => u.ref)))
      usage.set(ref, (usage.get(ref) ?? 0) + 1);
  return usage;
}

/** Former names per field id, from the catalog's change history (migration 080). */
async function loadRenames(): Promise<Map<string, string[]>> {
  const rows = await agentDb()
    .select<{ field_id: string; change: string; old_value: { name?: string } | null }>(
      "jt_custom_field_history",
      { filters: [eq("organization_id", currentOrganizationId())], limit: 5000 },
    )
    .catch(() => []);
  const out = new Map<string, string[]>();
  for (const h of rows)
    if (h.change === "renamed" && h.old_value?.name)
      out.set(h.field_id, [...(out.get(h.field_id) ?? []), h.old_value.name]);
  return out;
}

/** Declared JobTread (target, name) for aliases that were (or would be) matched by name. */
function declaredMatch(a: {
  key: string;
  source_name?: string | null;
  requested_target?: string | null;
}): AliasInput["declared"] {
  if (a.source_name && a.requested_target)
    return { target: a.requested_target, name: a.source_name };
  const def = SEMANTIC_DEFAULTS.find((d) => d.key === a.key)?.match;
  return def ? { target: def.target, name: def.name } : null;
}

/** Run the validator against live metadata. `viewer` adds permission reasons for non-admins. */
export async function buildFieldMappingReport(
  viewer?: ReportsAccess | null,
): Promise<ValidationReport> {
  const [fields, aliases, datasets, overrides, usage, renames] = await Promise.all([
    listCustomFields({ includeRemoved: true }),
    listBusinessFields(),
    loadDatasets(),
    loadOverrides(),
    loadUsage(),
    loadRenames(),
  ]);
  const byRef = new Map(overrides.map((o) => [o.internal_ref, o]));
  for (const [id, names] of renames) {
    const o = byRef.get(`cf:${id}`);
    if (o)
      o.previous_names = [
        ...new Set([...(Array.isArray(o.previous_names) ? o.previous_names : []), ...names]),
      ];
    else
      overrides.push({
        internal_ref: `cf:${id}`,
        reporting_enabled: true,
        previous_names: names,
      } as MappingRow);
  }
  const findings = analyzeAliases(aliases, fields);
  return validateFieldMappings({
    organizationId: currentOrganizationId(),
    fields,
    aliases: aliases.map((a) => ({
      key: a.key,
      label: a.label,
      custom_field_id: a.custom_field_id,
      mapped_by: a.mapped_by ?? null,
      updated_by: a.updated_by,
      review_status: a.review_status ?? null,
      archived_at: a.archived_at ?? null,
      declared: declaredMatch(a),
    })),
    aliasFindings: findings,
    datasets,
    overrides: overrides.map((o) => ({
      ...o,
      previous_names: Array.isArray(o.previous_names) ? o.previous_names : [],
    })),
    usage,
    viewer: viewer ? { isAdmin: viewer.isAdmin, categories: viewer.categories } : null,
  });
}

/**
 * Non-admin view of the report: only fields usable by this viewer, and only aliases whose
 * target they may see. Labels of excluded, unsynced, or restricted fields are never returned.
 */
export function visibleTo(report: ValidationReport, access: ReportsAccess): MappingResult[] {
  if (access.isAdmin || access.canManage) return report.results;
  return report.results.filter(
    (r) => r.reportable && r.exclusion?.reason !== "permission" && r.category !== "excluded",
  );
}

/**
 * Revalidate and persist the snapshot. Upserts one row per field/alias; never deletes rows and
 * never changes admin-owned columns (reporting_enabled, review notes) except to raise a review
 * flag the validator found.
 */
export async function revalidateFieldMappings(
  opts: { userId?: string | null; label?: string } = {},
): Promise<ValidationReport & { persisted: boolean }> {
  const report = await buildFieldMappingReport();
  if (!(await mappingSchemaReady())) return { ...report, persisted: false };
  const org = report.organizationId;
  const existing = new Map((await loadOverrides()).map((r) => [r.internal_ref, r]));
  const rows = report.results.map((r) => {
    const prior = existing.get(r.ref);
    const flagged = r.issues.some(
      (i) => i.code === "legacy_name_ambiguous" || i.code === "alias_ambiguous",
    );
    return {
      organization_id: org,
      internal_ref: r.ref,
      mapping_kind: r.kind,
      source_entity: r.entity,
      field_id: r.fieldId,
      current_name: r.currentName,
      previous_names: r.previousNames,
      field_type: r.type,
      mapping_status: r.mappingStatus,
      sync_status: r.syncStatus,
      exclusion_reason: r.exclusion?.reason ?? null,
      errors: r.issues.filter((i) => i.severity !== "info"),
      reporting_enabled: prior?.reporting_enabled ?? true,
      review_status:
        flagged && prior?.review_status !== "resolved"
          ? "needs_review"
          : (prior?.review_status ?? null),
      review_note: prior?.review_note ?? null,
      last_verified_at: report.validatedAt,
    };
  });
  for (let i = 0; i < rows.length; i += 200)
    await agentDb().upsert(MAPPINGS_TABLE, rows.slice(i, i + 200), [
      "organization_id",
      "internal_ref",
    ]);
  if (opts.userId !== undefined)
    await recordAudit({
      actor: { userId: opts.userId ?? null, label: opts.label ?? "system" },
      action: "reports.field_mappings_revalidated",
      targetType: MAPPINGS_TABLE,
      summary: `Field mappings revalidated: ${report.summary.total} checked, ${report.summary.errors} with errors, ${report.summary.needsReview} need review.`,
    }).catch(() => undefined);
  return { ...report, persisted: true };
}

async function requireSchema() {
  if (!(await mappingSchemaReady()))
    throw new ValidationError(
      "Field mapping settings need database migration 083 (jt_field_mappings). The health check still runs; apply the migration to change settings.",
    );
}

async function upsertOverride(ref: string, patch: Record<string, unknown>) {
  const report = await buildFieldMappingReport();
  const r = report.results.find((x) => x.ref === ref);
  if (!r) throw new ValidationError(`No field or business name "${ref}".`);
  await agentDb().upsert(
    MAPPINGS_TABLE,
    {
      organization_id: report.organizationId,
      internal_ref: ref,
      mapping_kind: r.kind,
      source_entity: r.entity,
      field_id: r.fieldId,
      current_name: r.currentName,
      field_type: r.type,
      mapping_status: r.mappingStatus,
      sync_status: r.syncStatus,
      exclusion_reason: r.exclusion?.reason ?? null,
      last_verified_at: report.validatedAt,
      ...patch,
    },
    ["organization_id", "internal_ref"],
  );
  return r;
}

/** Include or exclude an eligible field from reports. Never changes its access category. */
export async function setFieldReporting(input: {
  ref: string;
  enabled: boolean;
  note?: string | null;
  userId: string | null;
  label: string;
}): Promise<MappingResult> {
  await requireSchema();
  const report = await buildFieldMappingReport();
  const r = report.results.find((x) => x.ref === input.ref);
  if (!r || r.kind !== "field") throw new ValidationError(`No JobTread field "${input.ref}".`);
  // Eligible = live, synced, in a report source, and not excluded under Field access. The
  // toggle can't bring in an unsynced or privacy-excluded field, so it never widens access.
  if (!r.toggleable)
    throw new ValidationError(
      `${r.label} can't be switched ${input.enabled ? "on" : "off"} for reports: ${r.exclusion?.detail ?? "it isn't eligible"}`,
    );
  await upsertOverride(input.ref, {
    reporting_enabled: input.enabled,
    review_note: input.note ?? null,
    updated_by: input.userId,
  });
  const { invalidateFieldCatalog } = await import("./fields");
  invalidateFieldCatalog();
  await recordAudit({
    actor: { userId: input.userId, label: input.label },
    action: input.enabled ? "reports.field_reporting_enabled" : "reports.field_reporting_disabled",
    targetType: MAPPINGS_TABLE,
    targetId: input.ref,
    summary: `${input.enabled ? "Included" : "Excluded"} ${r.label} (${r.ref}) ${input.enabled ? "in" : "from"} reports.${input.note ? ` Note: ${input.note}` : ""}`,
  }).catch(() => undefined);
  return (await buildFieldMappingReport()).results.find((x) => x.ref === input.ref)!;
}

/**
 * Resolve a review: confirm the current target (keep) or re-point an alias at an explicit,
 * live field id chosen by an administrator. Never guessed.
 */
export async function resolveMappingReview(input: {
  ref: string;
  action: "confirm" | "repoint";
  fieldId?: string | null;
  note?: string | null;
  userId: string | null;
  label: string;
}): Promise<MappingResult> {
  await requireSchema();
  const report = await buildFieldMappingReport();
  const r = report.results.find((x) => x.ref === input.ref);
  if (!r) throw new ValidationError(`No field or business name "${input.ref}".`);
  if (input.action === "repoint") {
    if (r.kind !== "alias") throw new ValidationError("Only business names can be re-pointed.");
    const target = report.results.find(
      (x) => x.kind === "field" && x.fieldId === input.fieldId && x.syncStatus !== "stale",
    );
    if (!input.fieldId || !target)
      throw new ValidationError("Choose a live JobTread field by its id.");
    await updateSemanticField(r.ref.slice(4), { custom_field_id: target.fieldId }, input.userId);
    await agentDb()
      .update("jt_semantic_fields", [eq("key", r.ref.slice(4))], { mapped_by: "admin" })
      .catch(() => undefined);
  } else if (r.kind === "alias" && r.fieldId) {
    await agentDb()
      .update("jt_semantic_fields", [eq("key", r.ref.slice(4))], {
        review_status: "verified",
        reviewed_by: input.userId,
        reviewed_at: new Date().toISOString(),
      })
      .catch(() => undefined);
  }
  await upsertOverride(input.ref, {
    review_status: "resolved",
    review_note: input.note ?? null,
    updated_by: input.userId,
  });
  const { invalidateFieldCatalog } = await import("./fields");
  invalidateFieldCatalog();
  await recordAudit({
    actor: { userId: input.userId, label: input.label },
    action: "reports.field_mapping_review_resolved",
    targetType: MAPPINGS_TABLE,
    targetId: input.ref,
    summary:
      input.action === "repoint"
        ? `Re-pointed ${r.label} (${r.ref}) at cf:${input.fieldId}.`
        : `Confirmed ${r.label} (${r.ref}) → ${r.target ?? r.ref}.`,
  }).catch(() => undefined);
  return (await buildFieldMappingReport()).results.find((x) => x.ref === input.ref)!;
}

/** Search/filter/paginate a report for the admin UI and Dexter. */
export function queryMappings(
  results: MappingResult[],
  q: {
    search?: string;
    entity?: string;
    status?: string;
    exclusion?: string;
    kind?: "field" | "alias";
    issuesOnly?: boolean;
    offset?: number;
    limit?: number;
  },
) {
  const needle = q.search?.trim().toLowerCase();
  const rows = results.filter(
    (r) =>
      (!q.entity || r.entity === q.entity) &&
      (!q.kind || r.kind === q.kind) &&
      (!q.status || r.mappingStatus === q.status || r.syncStatus === q.status) &&
      (!q.exclusion || r.exclusion?.reason === q.exclusion) &&
      (!q.issuesOnly || r.issues.some((i) => i.severity !== "info")) &&
      (!needle ||
        r.label.toLowerCase().includes(needle) ||
        r.currentName.toLowerCase().includes(needle) ||
        r.ref.toLowerCase().includes(needle) ||
        (r.fieldId ?? "").toLowerCase().includes(needle) ||
        r.previousNames.some((p) => p.toLowerCase().includes(needle)) ||
        r.aliases.some((a) => a.includes(needle))),
  );
  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 50, 200);
  return { total: rows.length, offset, results: rows.slice(offset, offset + limit) };
}

export { lookupField };
