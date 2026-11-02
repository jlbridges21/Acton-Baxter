/**
 * Field mapping validator (pure): one structured verdict per JobTread field and business-name
 * alias, shared by the Field Mapping Health admin UI, the report engine's "why can't I use
 * this field" messages, and Dexter.
 *
 * Identity rules
 *   - A JobTread custom field is identified by its immutable JobTread id (`cf:<id>`). Its name
 *     is display data: a rename changes the label and nothing else.
 *   - Standard attributes (job name, projected price, cost-item quantity, …) have no JobTread
 *     field id. Their documented fallback identity is the attribute path Baxter reads
 *     (`jobtread:<org>:<entity>:attr:<key>`). Ids are never invented for them.
 *   - Business names (`sem:<key>`) are aliases that store a field id. Aliases that were mapped
 *     by name (never confirmed by an administrator) and whose name now matches several fields
 *     are flagged for review — never re-pointed automatically.
 *
 * Nothing here writes or deletes anything; persistence (snapshot, admin toggles) lives in
 * field-mappings.ts. The validator only reads metadata, sync state, and admin overrides.
 */

import type { FieldCategory } from "@/lib/jobtread/metadata";

/** Why a field is not usable in reports (the six documented reasons). */
export type ExclusionReason =
  | "intentional"
  | "unsupported_api"
  | "not_synced"
  | "synced_not_exposed"
  | "permission"
  | "broken_mapping";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  intentional: "Excluded on purpose",
  unsupported_api: "Not available from the JobTread API",
  not_synced: "Not synced",
  synced_not_exposed: "Synced, not in reports yet",
  permission: "Restricted by permission",
  broken_mapping: "Broken mapping",
};

export type MappingStatus = "ok" | "warning" | "needs_review" | "broken" | "unmapped" | "stale";
export type SyncStatus = "synced" | "not_synced" | "unsupported" | "stale";

export type MappingIssue = {
  code:
    | "field_removed"
    | "field_renamed"
    | "field_type_changed"
    | "duplicate_name"
    | "alias_conflict"
    | "alias_ambiguous"
    | "alias_stale"
    | "alias_unmapped"
    | "alias_shared_text"
    | "alias_deprecated"
    | "alias_target_unusable"
    | "legacy_name_ambiguous"
    | "dataset_disabled"
    | "dataset_never_synced"
    | "dataset_failed"
    | "values_not_requested"
    | "values_dropped_by_api"
    | "not_exposed"
    | "excluded_privacy"
    | "reporting_disabled"
    | "permission"
    | "unknown_entity";
  severity: "error" | "warning" | "info";
  message: string;
};

/** How each JobTread custom-field target reaches report data. */
export type EntityPipeline = {
  label: string;
  /** Sync Manager dataset that would carry the values. */
  dataset: string | null;
  /** That dataset requests customFieldValues for this target. */
  valuesRequested: boolean;
  /** A report source reads the cached values. */
  exposed: boolean;
  /** Where values live, for the detail view. */
  storage: string | null;
};

export const ENTITY_PIPELINES: Record<string, EntityPipeline> = {
  job: {
    label: "Jobs",
    dataset: "jobs",
    valuesRequested: true,
    exposed: true,
    storage: "jt_jobs.job_fields",
  },
  location: {
    label: "Locations",
    dataset: "jobs",
    valuesRequested: true,
    exposed: true,
    storage: "jt_jobs.location_fields (via each job's location)",
  },
  customer: {
    label: "Customers",
    dataset: "jobs",
    valuesRequested: true,
    exposed: true,
    storage: "jt_jobs.customer_fields (via each job's customer account)",
  },
  vendor: {
    label: "Vendors",
    dataset: "accounts",
    valuesRequested: true,
    exposed: false,
    storage: "jt_accounts.fields",
  },
  customerContact: {
    label: "Customer contacts",
    dataset: "contacts",
    valuesRequested: true,
    exposed: false,
    storage: "jt_contacts.fields",
  },
  vendorContact: {
    label: "Vendor contacts",
    dataset: "contacts",
    valuesRequested: true,
    exposed: false,
    storage: "jt_contacts.fields",
  },
  dailyLog: {
    label: "Daily logs",
    dataset: "daily_logs",
    valuesRequested: false,
    exposed: false,
    storage: null,
  },
  costItem: {
    label: "Cost items",
    dataset: "cost_items",
    valuesRequested: false,
    exposed: false,
    storage: null,
  },
};

/**
 * Entities with no JobTread custom fields (or none Baxter reads); listed so the health view
 * covers every entity the spec asks about. Their standard attributes use the fallback identity.
 */
export const STANDARD_ONLY_ENTITIES: Record<string, { label: string; note: string }> = {
  task: {
    label: "Tasks",
    note: "Synced (jt_tasks); the Tasks report source (task.*) reads standard attributes.",
  },
  file: {
    label: "Files",
    note: "Names and folders only (jt_files); no file URLs or contents are synced.",
  },
  catalogModel: {
    label: "Product library",
    note: "Top-level catalog cost groups; standard attributes only (model.*).",
  },
};

export type CustomFieldInput = {
  id: string;
  name: string;
  type: string;
  target_type: string;
  category: FieldCategory;
  display_name: string | null;
  removed_at: string | null;
  previous_type?: string | null;
  type_changed_at?: string | null;
  last_seen_at?: string | null;
};

export type AliasInput = {
  key: string;
  label: string;
  custom_field_id: string | null;
  mapped_by?: "auto" | "admin" | null;
  updated_by?: string | null;
  review_status?: string | null;
  archived_at?: string | null;
  /** Declared JobTread (target, name) the alias was matched by, when it was matched by name. */
  declared?: { target: string; name: string } | null;
};

export type AliasFindingInput = {
  key: string;
  status: "ok" | "unmapped" | "stale" | "conflict" | "ambiguous" | "shared_text" | "deprecated";
  reason: string | null;
  repair: { id: string; name: string } | null;
  candidates: Array<{ id: string; name: string; target: string; type: string }>;
};

export type DatasetInput = {
  key: string;
  enabled: boolean;
  status: string;
  lastSuccessAt: string | null;
  droppedFields: string[];
  lastError?: string | null;
};

/** Persisted admin state (jt_field_mappings); absent before migration 083. */
export type MappingOverride = {
  internal_ref: string;
  reporting_enabled: boolean;
  current_name?: string | null;
  previous_names?: string[] | null;
  field_type?: string | null;
  review_status?: "needs_review" | "resolved" | null;
  review_note?: string | null;
  last_verified_at?: string | null;
};

export type MappingResult = {
  ref: string;
  kind: "field" | "alias";
  identity: "jobtread_id" | "alias";
  sourceRef: string;
  fieldId: string | null;
  entity: string;
  entityLabel: string;
  currentName: string;
  label: string;
  previousNames: string[];
  type: string;
  category: FieldCategory | null;
  mappingStatus: MappingStatus;
  syncStatus: SyncStatus;
  /** Values are in report data and the field may be used (before viewer permission). */
  reportable: boolean;
  reportingEnabled: boolean;
  /** An administrator may switch reporting on/off (never widens access). */
  toggleable: boolean;
  exclusion: { reason: ExclusionReason; label: string; detail: string } | null;
  issues: MappingIssue[];
  /** sem:<key> → its target (aliases only). */
  target: string | null;
  aliases: string[];
  candidates: Array<{ id: string; name: string; target: string; type: string }>;
  repair: { id: string; name: string } | null;
  storage: string | null;
  dataset: string | null;
  usedBy: number;
  lastSeenAt: string | null;
  lastVerifiedAt: string | null;
};

export type ValidatorInput = {
  organizationId: string;
  fields: CustomFieldInput[];
  aliases: AliasInput[];
  aliasFindings: Map<string, AliasFindingInput>;
  datasets: DatasetInput[];
  overrides: MappingOverride[];
  /** ref → number of reports/views/metrics using it. */
  usage?: Map<string, number>;
  /**
   * The viewer, when validating for someone other than an administrator. Fields outside the
   * viewer's categories are reported with reason "permission" (labels of non-reportable fields
   * are never returned to non-administrators — callers filter).
   */
  viewer?: { isAdmin: boolean; categories: Set<string> } | null;
  now?: string;
};

export type ValidatorSummary = {
  total: number;
  fields: number;
  aliases: number;
  reportable: number;
  byMappingStatus: Record<MappingStatus, number>;
  bySyncStatus: Record<SyncStatus, number>;
  byExclusion: Record<ExclusionReason, number>;
  byEntity: Record<string, { total: number; reportable: number; issues: number }>;
  errors: number;
  warnings: number;
  needsReview: number;
};

export type ValidationReport = {
  organizationId: string;
  validatedAt: string;
  results: MappingResult[];
  summary: ValidatorSummary;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function standardSourceRef(org: string, entity: string, key: string) {
  return `jobtread:${org}:${entity}:attr:${key}`;
}

function datasetIssue(
  pipeline: EntityPipeline,
  datasets: Map<string, DatasetInput>,
): MappingIssue | null {
  if (!pipeline.dataset) return null;
  const ds = datasets.get(pipeline.dataset);
  // Core datasets (jobs) sync through the legacy full sync too; no state row means "core".
  if (!ds) return null;
  if (ds.droppedFields.includes("customFieldValues"))
    return {
      code: "values_dropped_by_api",
      severity: "warning",
      message: `JobTread rejected customFieldValues for the ${pipeline.dataset} dataset with this grant, so these values can't be read.`,
    };
  if (!ds.enabled)
    return {
      code: "dataset_disabled",
      severity: "info",
      message: `The ${pipeline.dataset} dataset is turned off in the Sync Manager.`,
    };
  if (!ds.lastSuccessAt)
    return {
      code: ds.status === "failed" ? "dataset_failed" : "dataset_never_synced",
      severity: ds.status === "failed" ? "error" : "info",
      message:
        ds.status === "failed"
          ? `The ${pipeline.dataset} dataset's last sync failed${ds.lastError ? `: ${ds.lastError}` : ""}.`
          : `The ${pipeline.dataset} dataset hasn't completed a sync yet.`,
    };
  return null;
}

/** Validate every field and alias. Pure and deterministic for a given input. */
export function validateFieldMappings(input: ValidatorInput): ValidationReport {
  const now = input.now ?? new Date().toISOString();
  const org = input.organizationId;
  const datasets = new Map(input.datasets.map((d) => [d.key, d]));
  const overrides = new Map(input.overrides.map((o) => [o.internal_ref, o]));
  const usage = input.usage ?? new Map<string, number>();
  const viewer = input.viewer && !input.viewer.isAdmin ? input.viewer : null;

  // Duplicate names among live fields, per target.
  const nameCount = new Map<string, number>();
  for (const f of input.fields.filter((x) => !x.removed_at)) {
    const k = `${f.target_type}|${norm(f.name)}`;
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const aliasesByField = new Map<string, string[]>();
  for (const a of input.aliases)
    if (a.custom_field_id && !a.archived_at)
      aliasesByField.set(a.custom_field_id, [
        ...(aliasesByField.get(a.custom_field_id) ?? []),
        `sem:${a.key}`,
      ]);

  const results: MappingResult[] = [];
  const byFieldId = new Map<string, MappingResult>();

  for (const f of input.fields) {
    const ref = `cf:${f.id}`;
    const pipeline = ENTITY_PIPELINES[f.target_type];
    const override = overrides.get(ref);
    const issues: MappingIssue[] = [];
    const previousNames = [...(override?.previous_names ?? [])];
    if (
      override?.current_name &&
      override.current_name !== f.name &&
      !previousNames.includes(override.current_name)
    )
      previousNames.push(override.current_name);
    const formerNames = previousNames.filter((n) => n !== f.name);
    if (formerNames.length)
      issues.push({
        code: "field_renamed",
        severity: "info",
        message: `Renamed in JobTread (formerly "${formerNames[formerNames.length - 1]}"). Reports keep working — they use the field id.`,
      });
    if (f.previous_type && f.type_changed_at)
      issues.push({
        code: "field_type_changed",
        severity: "warning",
        message: `Type changed from ${f.previous_type} to ${f.type} on ${f.type_changed_at.slice(0, 10)}. Check filters and number formats that assume the old type.`,
      });
    if (!f.removed_at && (nameCount.get(`${f.target_type}|${norm(f.name)}`) ?? 0) > 1)
      issues.push({
        code: "duplicate_name",
        severity: "warning",
        message: `Another ${pipeline?.label.toLowerCase() ?? f.target_type} field has the same name. Reports pick fields by id, so both stay distinct; pick by id when building reports.`,
      });

    let syncStatus: SyncStatus = "synced";
    let exclusion: MappingResult["exclusion"] = null;
    const exclude = (reason: ExclusionReason, detail: string) => {
      exclusion ??= { reason, label: EXCLUSION_LABELS[reason], detail };
    };
    const reportingEnabled = override?.reporting_enabled ?? true;

    if (f.removed_at) {
      syncStatus = "stale";
      issues.push({
        code: "field_removed",
        severity: "error",
        message: `Removed from JobTread on ${f.removed_at.slice(0, 10)}. Its history is kept; reports that use it show a reason instead of values.`,
      });
      exclude(
        "broken_mapping",
        `The field no longer exists in JobTread (removed ${f.removed_at.slice(0, 10)}).`,
      );
    } else if (!pipeline) {
      syncStatus = "unsupported";
      issues.push({
        code: "unknown_entity",
        severity: "info",
        message: `Baxter has no dataset for JobTread "${f.target_type}" records.`,
      });
      exclude(
        "unsupported_api",
        `JobTread "${f.target_type}" records aren't available through Baxter's JobTread integration.`,
      );
    } else {
      const dsIssue = datasetIssue(pipeline, datasets);
      if (dsIssue?.code === "values_dropped_by_api") {
        syncStatus = "unsupported";
        issues.push(dsIssue);
        exclude("unsupported_api", dsIssue.message);
      } else if (!pipeline.valuesRequested) {
        syncStatus = "not_synced";
        issues.push({
          code: "values_not_requested",
          severity: "info",
          message: `The ${pipeline.dataset} sync doesn't request custom field values yet.`,
        });
        exclude(
          "not_synced",
          `${pipeline.label} custom field values aren't synced yet (the ${pipeline.dataset} dataset reads standard attributes only).`,
        );
      } else if (f.category === "excluded" && pipeline.exposed) {
        syncStatus = "not_synced";
        issues.push({
          code: "excluded_privacy",
          severity: "info",
          message: "Excluded under Field access: values aren't cached or shown.",
        });
        exclude(
          "intentional",
          "An administrator excluded this field under Field access (privacy). Its values aren't cached.",
        );
      } else if (f.category === "excluded") {
        syncStatus = "not_synced";
        issues.push({
          code: "excluded_privacy",
          severity: "info",
          message: `${pipeline.label} fields are excluded by default; values are cached only after an administrator allows the field under Field access.`,
        });
        exclude(
          "not_synced",
          `${pipeline.label} field values are cached only after an administrator allows the field under Field access.`,
        );
      } else if (dsIssue) {
        syncStatus = "not_synced";
        issues.push(dsIssue);
        exclude("not_synced", dsIssue.message);
      } else if (!pipeline.exposed) {
        issues.push({
          code: "not_exposed",
          severity: "info",
          message: `Values are cached in ${pipeline.storage}, but no report source reads ${pipeline.label.toLowerCase()} yet.`,
        });
        exclude(
          "synced_not_exposed",
          `Values are synced (${pipeline.storage}) but ${pipeline.label.toLowerCase()} aren't a report source yet.`,
        );
      } else if (!reportingEnabled) {
        issues.push({
          code: "reporting_disabled",
          severity: "info",
          message: "Turned off for reports by an administrator. Values are still synced and kept.",
        });
        exclude(
          "intentional",
          "An administrator turned this field off for reports. Values are still synced, so it can be turned back on.",
        );
      }
    }
    if (!exclusion && viewer && !viewer.categories.has(f.category)) {
      issues.push({
        code: "permission",
        severity: "info",
        message: "You don't have access to this field's data category.",
      });
      exclude("permission", "Your access doesn't include this field's data category.");
    }
    const live = !f.removed_at;
    const hasError = issues.some((i) => i.severity === "error");
    const r: MappingResult = {
      ref,
      kind: "field",
      identity: "jobtread_id",
      sourceRef: `jobtread:${org}:${f.target_type}:${f.id}`,
      fieldId: f.id,
      entity: f.target_type,
      entityLabel: pipeline?.label ?? f.target_type,
      currentName: f.name,
      label: f.display_name || f.name,
      previousNames,
      type: f.type,
      category: f.category,
      mappingStatus: !live
        ? "stale"
        : override?.review_status === "needs_review"
          ? "needs_review"
          : hasError
            ? "broken"
            : issues.some((i) => i.severity === "warning")
              ? "warning"
              : "ok",
      syncStatus,
      reportable: !exclusion || (exclusion as { reason: ExclusionReason }).reason === "permission",
      reportingEnabled,
      toggleable:
        live && Boolean(pipeline?.exposed) && f.category !== "excluded" && syncStatus === "synced",
      exclusion,
      issues,
      target: null,
      aliases: aliasesByField.get(f.id) ?? [],
      candidates: [],
      repair: null,
      storage: pipeline?.storage ?? null,
      dataset: pipeline?.dataset ?? null,
      usedBy: usage.get(ref) ?? 0,
      lastSeenAt: f.last_seen_at ?? null,
      lastVerifiedAt: now,
    };
    results.push(r);
    byFieldId.set(f.id, r);
  }

  for (const a of input.aliases) {
    if (a.archived_at) continue;
    const ref = `sem:${a.key}`;
    const finding = input.aliasFindings.get(a.key);
    const target = a.custom_field_id ? byFieldId.get(a.custom_field_id) : undefined;
    const override = overrides.get(ref);
    const issues: MappingIssue[] = [];
    let mappingStatus: MappingStatus = "ok";
    const status = finding?.status ?? (a.custom_field_id ? "ok" : "unmapped");
    if (status === "unmapped") {
      mappingStatus = "unmapped";
      issues.push({
        code: "alias_unmapped",
        severity: "info",
        message: finding?.reason ?? "Not mapped to a JobTread field.",
      });
    } else if (status === "stale" || (a.custom_field_id && !target)) {
      mappingStatus = "broken";
      issues.push({
        code: "alias_stale",
        severity: "error",
        message: finding?.reason ?? "Its JobTread field no longer exists.",
      });
    } else if (status === "conflict") {
      mappingStatus = "broken";
      issues.push({
        code: "alias_conflict",
        severity: "error",
        message: finding?.reason ?? "Points at a different field than its declaration.",
      });
    } else if (status === "ambiguous") {
      mappingStatus = "needs_review";
      issues.push({
        code: "alias_ambiguous",
        severity: "warning",
        message: finding?.reason ?? "Several fields could be meant; an administrator must choose.",
      });
    } else if (status === "shared_text") {
      mappingStatus = "warning";
      issues.push({
        code: "alias_shared_text",
        severity: "warning",
        message: finding?.reason ?? "Reads a shared narrative text field.",
      });
    } else if (status === "deprecated") {
      mappingStatus = "warning";
      issues.push({
        code: "alias_deprecated",
        severity: "warning",
        message: finding?.reason ?? "Retired by an administrator.",
      });
    }
    // Legacy name-based mapping: matched by name, never confirmed, and the name is now shared.
    const confirmed =
      a.mapped_by === "admin" || Boolean(a.updated_by) || a.review_status === "verified";
    if (
      !confirmed &&
      a.custom_field_id &&
      target &&
      a.declared &&
      (nameCount.get(`${a.declared.target}|${norm(a.declared.name)}`) ?? 0) > 1
    ) {
      mappingStatus = mappingStatus === "broken" ? "broken" : "needs_review";
      issues.push({
        code: "legacy_name_ambiguous",
        severity: "warning",
        message: `Mapped automatically by the name "${a.declared.name}", which ${nameCount.get(`${a.declared.target}|${norm(a.declared.name)}`)} JobTread fields now share. It was not changed; an administrator should confirm which field it means.`,
      });
    }
    if (override?.review_status === "needs_review" && mappingStatus !== "broken")
      mappingStatus = "needs_review";
    if (target && target.exclusion && mappingStatus !== "broken") {
      issues.push({
        code: "alias_target_unusable",
        severity: "info",
        message: `Its field "${target.label}" isn't usable in reports: ${target.exclusion.detail}`,
      });
    }
    // An unmapped business name isn't broken — it simply has no field yet (status "unmapped",
    // not usable, no exclusion reason). Broken or ambiguous aliases are broken mappings.
    const unusable = mappingStatus === "broken" || status === "ambiguous";
    const exclusion: MappingResult["exclusion"] = unusable
      ? {
          reason: "broken_mapping",
          label: EXCLUSION_LABELS.broken_mapping,
          detail:
            issues.find((i) => i.severity !== "info")?.message ??
            issues[0]?.message ??
            "Not mapped.",
        }
      : (target?.exclusion ?? null);
    results.push({
      ref,
      kind: "alias",
      identity: "alias",
      sourceRef: target ? target.sourceRef : `baxter:${org}:alias:${a.key}`,
      fieldId: a.custom_field_id,
      entity: target?.entity ?? a.declared?.target ?? "job",
      entityLabel:
        target?.entityLabel ?? ENTITY_PIPELINES[a.declared?.target ?? "job"]?.label ?? "Jobs",
      currentName: target?.currentName ?? a.label,
      label: a.label,
      previousNames: [],
      type: target?.type ?? "alias",
      category: target?.category ?? null,
      mappingStatus,
      syncStatus: target?.syncStatus ?? "not_synced",
      reportable: mappingStatus !== "unmapped" && (!exclusion || exclusion.reason === "permission"),
      reportingEnabled: target?.reportingEnabled ?? true,
      toggleable: false,
      exclusion,
      issues,
      target: target?.ref ?? null,
      aliases: [],
      candidates: finding?.candidates ?? [],
      repair: finding?.repair ?? null,
      storage: target?.storage ?? null,
      dataset: target?.dataset ?? null,
      usedBy: usage.get(ref) ?? 0,
      lastSeenAt: target?.lastSeenAt ?? null,
      lastVerifiedAt: now,
    });
  }

  return { organizationId: org, validatedAt: now, results, summary: summarize(results) };
}

export function summarize(results: MappingResult[]): ValidatorSummary {
  const s: ValidatorSummary = {
    total: results.length,
    fields: 0,
    aliases: 0,
    reportable: 0,
    byMappingStatus: { ok: 0, warning: 0, needs_review: 0, broken: 0, unmapped: 0, stale: 0 },
    bySyncStatus: { synced: 0, not_synced: 0, unsupported: 0, stale: 0 },
    byExclusion: {
      intentional: 0,
      unsupported_api: 0,
      not_synced: 0,
      synced_not_exposed: 0,
      permission: 0,
      broken_mapping: 0,
    },
    byEntity: {},
    errors: 0,
    warnings: 0,
    needsReview: 0,
  };
  for (const r of results) {
    if (r.kind === "field") s.fields++;
    else s.aliases++;
    if (r.reportable) s.reportable++;
    s.byMappingStatus[r.mappingStatus]++;
    // Sync status describes JobTread fields; aliases inherit it from their field.
    if (r.kind === "field") s.bySyncStatus[r.syncStatus]++;
    if (r.exclusion) s.byExclusion[r.exclusion.reason]++;
    const e = (s.byEntity[r.entity] ??= { total: 0, reportable: 0, issues: 0 });
    e.total++;
    if (r.reportable) e.reportable++;
    if (r.issues.some((i) => i.severity !== "info")) e.issues++;
    if (r.issues.some((i) => i.severity === "error")) s.errors++;
    else if (r.issues.some((i) => i.severity === "warning")) s.warnings++;
    if (r.mappingStatus === "needs_review") s.needsReview++;
  }
  return s;
}

export type FieldLookup =
  | { status: "resolved"; result: MappingResult }
  | { status: "ambiguous"; matches: MappingResult[]; message: string }
  | { status: "unavailable"; result: MappingResult; message: string }
  | { status: "not_found"; message: string };

/**
 * Resolve what a person or Dexter typed — a ref (cf:/sem:), a JobTread field id, a current
 * name, or a former name — to exactly one field. Several matches are returned as ambiguous;
 * this never picks one by position.
 */
export function lookupField(
  results: MappingResult[],
  query: string,
  opts: { entity?: string | null } = {},
): FieldLookup {
  const q = query.trim();
  if (!q) return { status: "not_found", message: "Enter a field name, id, or reference." };
  const scoped = opts.entity ? results.filter((r) => r.entity === opts.entity) : results;
  const exact =
    results.find((r) => r.ref === q) ??
    results.find((r) => r.kind === "field" && r.fieldId === q) ??
    null;
  let matches: MappingResult[] = exact ? [exact] : [];
  if (!matches.length) {
    const n = norm(q);
    matches = scoped.filter(
      (r) => r.kind === "field" && (norm(r.label) === n || norm(r.currentName) === n),
    );
    if (!matches.length)
      matches = scoped.filter(
        (r) =>
          (r.kind === "alias" && norm(r.label) === n) ||
          (r.kind === "field" && r.previousNames.some((p) => norm(p) === n)),
      );
  }
  if (!matches.length)
    return { status: "not_found", message: `No JobTread field or business name matches "${q}".` };
  // Prefer live fields over removed ones with the same name, but never choose among live ones.
  const live = matches.filter((m) => m.syncStatus !== "stale");
  if (live.length > 1)
    return {
      status: "ambiguous",
      matches: live,
      message: `"${q}" matches ${live.length} fields: ${live
        .map((m) => `${m.label} (${m.entityLabel}, ${m.ref})`)
        .join("; ")}. Choose one by its reference.`,
    };
  const result = live[0] ?? matches[0]!;
  if (result.exclusion && result.exclusion.reason !== "permission")
    return {
      status: "unavailable",
      result,
      message: `${result.label} (${result.ref}) can't be used in reports — ${result.exclusion.label}: ${result.exclusion.detail}`,
    };
  return { status: "resolved", result };
}
