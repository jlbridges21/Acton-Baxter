/**
 * JobTread Sync Manager: per-entity, chunked, checkpointed, resumable syncs into Baxter's
 * reporting cache. JobTread is only read.
 *
 * Lifecycle of a run (jt_sync_entity_runs):
 *   queued → running → completed | partial | failed | permission_blocked | cancelled
 *
 * - A request creates one run per entity under a shared batch id and enqueues one durable
 *   `jobtread_sync` job (metadata.mode = "entities"). The job advances runs within a time
 *   budget, then re-enqueues itself, so no single request has to finish a large dataset.
 * - Paged entities save their Pave cursor after every page. A run interrupted mid-way is
 *   picked up from that cursor (by the continuation job, the stale-run sweep, or Retry).
 * - Rows are upserted per page. Rows missing from JobTread are soft-removed only after the
 *   final page succeeds, and never when the source suddenly shrinks by more than half — so a
 *   failed, partial, or suspicious run never erases the last good data.
 * - A lease id on the run means two workers can never page the same run at once.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { agentDb, eq, inList, selectOne, type Filter } from "@/lib/agents/store";
import { missingField } from "./catalog";
import { getJobTreadConfig, JobTreadError, newStats, pave, type PaveStats } from "./client";
import {
  DEFAULT_ENABLED,
  getSyncEntity,
  isSyncEntityKey,
  orderByDependencies,
  pruneNodes,
  SYNC_ENTITIES,
  type SyncEntityDef,
  type SyncEntityKey,
} from "./entities";
import { listCustomFields, syncCustomFieldMetadata } from "./metadata";
import { syncCatalogModels, syncDocuments, syncJobs } from "./sync";

export type StoredEntityStatus =
  | "ready"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "partial"
  | "disabled"
  | "permission_blocked";
export type EntityStatus = StoredEntityStatus | "not_configured";
export type RunStatus =
  "queued" | "running" | "completed" | "failed" | "partial" | "cancelled" | "permission_blocked";

export type EntityStateRow = {
  entity: SyncEntityKey;
  enabled: boolean;
  schedule: "daily" | "manual";
  status: StoredEntityStatus;
  last_run_id: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  records_cached: number | null;
  dropped_fields: string[];
  updated_by: string | null;
  updated_at: string;
};

export type EntityRunRow = {
  id: string;
  entity: SyncEntityKey;
  batch_id: string;
  status: RunStatus;
  triggered_by: string;
  job_id: string | null;
  cursor: string | null;
  generation: string | null;
  resumed_from: string | null;
  lease_id: string | null;
  pages: number;
  records_seen: number;
  records_upserted: number;
  records_removed: number;
  api_requests: number;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  error: string | null;
  error_code: string | null;
  created_at: string;
};

export type SyncSettingsRow = {
  id: "default";
  daily_enabled: boolean;
  daily_hour_utc: number;
  last_daily_enqueued_at: string | null;
  updated_by: string | null;
  updated_at: string;
};

const ACTIVE: RunStatus[] = ["queued", "running"];
/** A running run whose worker hasn't checkpointed for this long is considered abandoned. */
export const STALE_RUN_MS = 5 * 60_000;
/** Work per job before handing off to a continuation job (the cron route allows 800s). */
export const STEP_BUDGET_MS = 240_000;
const MAX_FIELD_PRUNES = 8;
/** Skip soft-removal when a full run sees fewer than this share of the rows cached before. */
const SHRINK_GUARD_RATIO = 0.5;

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// State + settings
// ---------------------------------------------------------------------------

function defaultState(key: SyncEntityKey): EntityStateRow {
  const enabled = DEFAULT_ENABLED.has(key);
  return {
    entity: key,
    enabled,
    schedule: "daily",
    status: enabled ? "ready" : "disabled",
    last_run_id: null,
    last_started_at: null,
    last_finished_at: null,
    last_success_at: null,
    last_error: null,
    last_error_code: null,
    records_cached: null,
    dropped_fields: [],
    updated_by: null,
    updated_at: nowIso(),
  };
}

/** Every registry entity has a state row (the migration seeds them; this covers new ones). */
export async function ensureEntityStates(): Promise<EntityStateRow[]> {
  const db = agentDb();
  const rows = await db.select<EntityStateRow>("jt_sync_entities", {});
  const have = new Set(rows.map((r) => r.entity));
  for (const def of SYNC_ENTITIES) {
    if (have.has(def.key)) continue;
    const [row] = await db.upsert<EntityStateRow>("jt_sync_entities", defaultState(def.key), [
      "entity",
    ]);
    if (row) rows.push(row);
  }
  const order = new Map(SYNC_ENTITIES.map((d) => [d.key, d.priority]));
  return rows
    .filter((r) => isSyncEntityKey(r.entity))
    .map((r) => ({ ...r, dropped_fields: Array.isArray(r.dropped_fields) ? r.dropped_fields : [] }))
    .sort((a, b) => (order.get(a.entity) ?? 999) - (order.get(b.entity) ?? 999));
}

export async function getEntityState(key: SyncEntityKey): Promise<EntityStateRow> {
  const states = await ensureEntityStates();
  return states.find((s) => s.entity === key) ?? defaultState(key);
}

async function patchState(key: SyncEntityKey, patch: Partial<EntityStateRow>) {
  await agentDb().update("jt_sync_entities", [eq("entity", key)], {
    ...patch,
    updated_at: nowIso(),
  });
}

export async function getSyncSettings(): Promise<SyncSettingsRow> {
  const row = await selectOne<SyncSettingsRow>("jt_sync_settings", {
    filters: [eq("id", "default")],
  });
  if (row) return row;
  const fresh: SyncSettingsRow = {
    id: "default",
    daily_enabled: true,
    daily_hour_utc: 10,
    last_daily_enqueued_at: null,
    updated_by: null,
    updated_at: nowIso(),
  };
  await agentDb().upsert("jt_sync_settings", fresh, ["id"]);
  return fresh;
}

export async function updateSyncSettings(
  patch: Partial<Pick<SyncSettingsRow, "daily_enabled" | "daily_hour_utc">>,
  userId: string | null,
): Promise<SyncSettingsRow> {
  const current = await getSyncSettings();
  await agentDb().upsert(
    "jt_sync_settings",
    { ...current, ...patch, id: "default", updated_by: userId, updated_at: nowIso() },
    ["id"],
  );
  return getSyncSettings();
}

export async function setEntityEnabled(
  key: SyncEntityKey,
  enabled: boolean,
  userId: string | null,
): Promise<EntityStateRow> {
  const state = await getEntityState(key);
  await patchState(key, {
    enabled,
    status: enabled ? (state.status === "disabled" ? "ready" : state.status) : "disabled",
    updated_by: userId,
  });
  if (!enabled) {
    // Queued work for a disabled dataset is cancelled; cached rows are kept as they are.
    await agentDb().update("jt_sync_entity_runs", [eq("entity", key), eq("status", "queued")], {
      status: "cancelled",
      finished_at: nowIso(),
      error: "Dataset disabled",
      lease_id: null,
    });
  }
  return getEntityState(key);
}

export async function setEntitySchedule(
  key: SyncEntityKey,
  schedule: "daily" | "manual",
  userId: string | null,
): Promise<EntityStateRow> {
  await patchState(key, { schedule, updated_by: userId });
  return getEntityState(key);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listEntityRuns(
  options: {
    entity?: SyncEntityKey;
    batchId?: string;
    status?: RunStatus[];
    limit?: number;
  } = {},
): Promise<EntityRunRow[]> {
  const filters: Filter[] = [];
  if (options.entity) filters.push(eq("entity", options.entity));
  if (options.batchId) filters.push(eq("batch_id", options.batchId));
  if (options.status) filters.push(inList("status", options.status));
  return agentDb().select<EntityRunRow>("jt_sync_entity_runs", {
    filters,
    order: { col: "created_at", ascending: false },
    limit: options.limit ?? 50,
  });
}

export async function getEntityRun(id: string): Promise<EntityRunRow | null> {
  return selectOne<EntityRunRow>("jt_sync_entity_runs", { filters: [eq("id", id)] });
}

function isAbandoned(run: EntityRunRow, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  const beat = run.heartbeat_at ?? run.started_at ?? run.created_at;
  return now - new Date(beat).getTime() > STALE_RUN_MS;
}

export type SyncRequestResult = {
  batchId: string | null;
  jobId: string | null;
  runs: Array<{ runId: string; entity: SyncEntityKey; status: RunStatus; reused: boolean }>;
  skipped: Array<{ entity: string; reason: string }>;
};

type RunSeed = {
  entity: SyncEntityKey;
  cursor?: string | null;
  generation?: string | null;
  resumedFrom?: string | null;
  pages?: number;
  recordsSeen?: number;
};

async function createRunsAndEnqueue(
  seeds: RunSeed[],
  triggeredBy: string,
  skipped: SyncRequestResult["skipped"],
): Promise<SyncRequestResult> {
  const result: SyncRequestResult = { batchId: null, jobId: null, runs: [], skipped };
  const fresh: RunSeed[] = [];
  for (const seed of seeds) {
    const [active] = await listEntityRuns({ entity: seed.entity, status: ACTIVE, limit: 1 });
    if (active) {
      result.runs.push({
        runId: active.id,
        entity: seed.entity,
        status: active.status,
        reused: true,
      });
      continue;
    }
    fresh.push(seed);
  }
  if (!fresh.length) return result;
  const batchId = randomUUID();
  const created: EntityRunRow[] = [];
  for (const seed of fresh) {
    const [run] = await agentDb().insert<EntityRunRow>("jt_sync_entity_runs", {
      entity: seed.entity,
      batch_id: batchId,
      status: "queued",
      triggered_by: triggeredBy.slice(0, 120),
      cursor: seed.cursor ?? null,
      generation: seed.generation ?? null,
      resumed_from: seed.resumedFrom ?? null,
      pages: seed.pages ?? 0,
      records_seen: seed.recordsSeen ?? 0,
      records_upserted: 0,
      records_removed: 0,
      api_requests: 0,
    });
    created.push(run!);
    await patchState(seed.entity, { status: "queued", last_run_id: run!.id });
  }
  const { enqueueJob } = await import("@/lib/jobs/queue");
  const job = await enqueueJob({
    jobType: "jobtread_sync",
    metadata: { mode: "entities", batchId, source: triggeredBy.slice(0, 120) },
  });
  await agentDb().update("jt_sync_entity_runs", [eq("batch_id", batchId)], { job_id: job.id });
  result.batchId = batchId;
  result.jobId = job.id;
  for (const run of created)
    result.runs.push({ runId: run.id, entity: run.entity, status: "queued", reused: false });
  return result;
}

/**
 * Queue a sync for the given entities (dependency order). Disabled entities are skipped;
 * entities with a queued/running run reuse it. Returns the real run and job ids.
 */
export async function requestEntitySync(input: {
  entities: string[];
  triggeredBy: string;
}): Promise<SyncRequestResult> {
  const skipped: SyncRequestResult["skipped"] = [];
  if (!getJobTreadConfig()) {
    return {
      batchId: null,
      jobId: null,
      runs: [],
      skipped: input.entities.map((entity) => ({
        entity,
        reason: "JobTread isn't connected (JOBTREAD_GRANT_KEY is not set).",
      })),
    };
  }
  const states = await ensureEntityStates();
  const keys: SyncEntityKey[] = [];
  for (const raw of new Set(input.entities)) {
    if (!isSyncEntityKey(raw)) {
      skipped.push({ entity: raw, reason: "Unknown dataset." });
      continue;
    }
    const state = states.find((s) => s.entity === raw);
    if (!state?.enabled) {
      skipped.push({ entity: raw, reason: "Dataset is disabled. Enable it first." });
      continue;
    }
    keys.push(raw);
  }
  return createRunsAndEnqueue(
    orderByDependencies(keys).map((entity) => ({ entity })),
    input.triggeredBy,
    skipped,
  );
}

/**
 * Retry an entity. A partial/failed paged run resumes from its saved cursor and generation, so
 * pages already cached aren't fetched again and nothing is removed until the full pass ends.
 */
export async function retryEntitySync(
  key: SyncEntityKey,
  triggeredBy: string,
): Promise<SyncRequestResult> {
  const state = await getEntityState(key);
  if (!state.enabled)
    return {
      batchId: null,
      jobId: null,
      runs: [],
      skipped: [{ entity: key, reason: "Dataset is disabled. Enable it first." }],
    };
  if (!getJobTreadConfig()) return requestEntitySync({ entities: [key], triggeredBy });
  const [last] = await listEntityRuns({ entity: key, limit: 1 });
  const resumable =
    last &&
    (last.status === "partial" || last.status === "failed") &&
    getSyncEntity(key)?.kind === "paged" &&
    last.cursor;
  return createRunsAndEnqueue(
    [
      resumable
        ? {
            entity: key,
            cursor: last.cursor,
            generation: last.generation,
            resumedFrom: last.id,
            pages: last.pages,
            recordsSeen: last.records_seen,
          }
        : { entity: key },
    ],
    triggeredBy,
    [],
  );
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export function classifySyncError(error: unknown): {
  status: "failed" | "permission_blocked";
  code: string;
  message: string;
} {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Sync failed";
  if (error instanceof JobTreadError) {
    if (error.code === "AUTH_FAILED" || error.status === 403)
      return { status: "permission_blocked", code: error.code, message };
    if (/permission|not (allowed|authorized)|access denied|forbidden/i.test(error.message))
      return { status: "permission_blocked", code: "PERMISSION", message };
    return { status: "failed", code: error.code, message };
  }
  return { status: "failed", code: "INTERNAL", message };
}

/** Lease a run for this worker. Returns null when another worker holds it. */
async function claimRun(run: EntityRunRow): Promise<EntityRunRow | null> {
  if (run.status === "running" && !isAbandoned(run)) return null;
  if (run.status !== "running" && run.status !== "queued") return null;
  const lease = randomUUID();
  const now = nowIso();
  const [claimed] = await agentDb().update<EntityRunRow>(
    "jt_sync_entity_runs",
    [
      eq("id", run.id),
      eq("status", run.status),
      run.lease_id ? eq("lease_id", run.lease_id) : { col: "lease_id", op: "is_null" },
    ],
    {
      status: "running",
      lease_id: lease,
      started_at: run.started_at ?? now,
      generation: run.generation ?? now,
      heartbeat_at: now,
    },
  );
  return claimed ?? null;
}

/** Checkpoint under the lease. Returns false if the lease was lost (stop working). */
async function checkpoint(run: EntityRunRow, patch: Partial<EntityRunRow>): Promise<boolean> {
  const rows = await agentDb().update<EntityRunRow>(
    "jt_sync_entity_runs",
    [eq("id", run.id), eq("lease_id", run.lease_id)],
    { ...patch, heartbeat_at: nowIso() },
  );
  return rows.length > 0;
}

async function allowedFieldMap(): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const f of await listCustomFields()) {
    if (f.category === "excluded") continue;
    if (!map.has(f.target_type)) map.set(f.target_type, new Set());
    map.get(f.target_type)!.add(f.id);
  }
  return map;
}

type Page = { nextPage: string | null; nodes: Record<string, unknown>[] };

/** One Pave page. Shrinks on 413; drops fields JobTread says don't exist (recorded). */
async function fetchPage(
  def: SyncEntityDef,
  cursor: string | null,
  dropped: string[],
  stats: PaveStats,
  onDrop: (field: string) => Promise<void>,
): Promise<Page> {
  const config = getJobTreadConfig();
  if (!config) throw new JobTreadError("JobTread isn't connected.", "NOT_CONFIGURED");
  const connection = def.connection!;
  let size = def.pageSize ?? 100;
  for (let attempt = 0; attempt < MAX_FIELD_PRUNES + 6; attempt++) {
    const conn = {
      $: { ...(def.args ?? {}), size, ...(cursor ? { page: cursor } : {}) },
      nextPage: {},
      nodes: pruneNodes(def.nodes!, dropped),
    };
    try {
      const res = await pave<{ organization: Record<string, Page> | null }>(
        { organization: { $: { id: config.organizationId }, id: {}, [connection]: conn } },
        { stats },
      );
      const block = res.organization?.[connection];
      if (!block) throw new JobTreadError(`JobTread returned no ${connection}.`, "UNAVAILABLE");
      return { nextPage: block.nextPage ?? null, nodes: block.nodes ?? [] };
    } catch (error) {
      if (error instanceof JobTreadError && error.code === "TOO_LARGE" && size > 5) {
        size = Math.max(5, Math.floor(size / 2));
        continue;
      }
      const field = missingField(error);
      if (field === connection)
        throw new JobTreadError(
          `JobTread doesn't offer "${connection}" to this grant.`,
          "BAD_QUERY",
          400,
        );
      if (field && field !== "id" && field in def.nodes! && !dropped.includes(field)) {
        dropped.push(field);
        await onDrop(field);
        continue;
      }
      throw error;
    }
  }
  throw new JobTreadError(`Couldn't build a valid ${connection} query.`, "BAD_QUERY");
}

async function recordLegacyRun(
  kind: "metadata" | "jobs" | "catalog",
  triggeredBy: string,
  started: number,
  stats: PaveStats,
  seen: number,
  removed: number,
) {
  // Keeps lastSuccessfulSync() (report freshness) accurate for runs made here.
  await agentDb().insert("jt_sync_runs", {
    kind,
    status: "succeeded",
    triggered_by: `sync-manager:${triggeredBy}`.slice(0, 120),
    started_at: new Date(started).toISOString(),
    finished_at: nowIso(),
    api_requests: stats.requests,
    records_seen: seen,
    records_upserted: seen,
    records_removed: removed,
    duration_ms: Date.now() - started,
  });
}

async function runCoreEntity(
  key: SyncEntityKey,
  stats: PaveStats,
  triggeredBy: string,
): Promise<{ seen: number; removed: number }> {
  const started = Date.now();
  if (key === "custom_fields") {
    const r = await syncCustomFieldMetadata(stats);
    await recordLegacyRun("metadata", triggeredBy, started, stats, r.seen, r.removed);
    await import("@/lib/reports/fields").then((m) => m.invalidateFieldCatalog());
    return { seen: r.seen, removed: r.removed };
  }
  if (key === "jobs") {
    const r = await syncJobs(stats);
    await recordLegacyRun("jobs", triggeredBy, started, stats, r.seen, r.removed);
    await afterSearchableSync("jobtread-jobs");
    return r;
  }
  if (key === "documents") {
    const r = await syncDocuments(stats);
    await afterSearchableSync("jobtread-documents");
    return r;
  }
  if (key === "catalog_models") {
    const r = await syncCatalogModels(stats);
    await recordLegacyRun("catalog", triggeredBy, started, stats, r.seen, r.removed);
    return r;
  }
  throw new Error(`${key} is not a core dataset.`);
}

/** Keep Global Search and the field/job caches in step. Never fails the sync. */
async function afterSearchableSync(provider: string) {
  await import("@/lib/reports/fields")
    .then((m) => m.invalidateFieldCatalog())
    .catch(() => undefined);
  await import("./detail").then((m) => m.clearJobDetailCache()).catch(() => undefined);
  await import("@/lib/search/providers/indexed")
    .then((m) => m.invalidateSourceDocs())
    .catch(() => undefined);
  await import("@/lib/search/admin")
    .then((m) => m.reindexProviderById(provider, "jobtread-sync"))
    .catch(() => undefined);
}

/** Soft-remove rows not seen since `generation` (only called after the last page). */
async function reconcile(table: string, generation: string): Promise<number> {
  const removed = await agentDb().update<{ id: string }>(
    table,
    [
      { col: "removed_at", op: "is_null" },
      { col: "synced_at", op: "lt", value: generation },
    ],
    { removed_at: nowIso() },
  );
  return removed.length;
}

/** Reports cache the catalog for a minute; refresh it after catalog data changes. */
async function invalidateReportCaches(key: SyncEntityKey) {
  if (!["catalog_models", "cost_groups", "cost_items", "jobs"].includes(key)) return;
  await import("@/lib/reports/engine")
    .then((m) => m.invalidateCatalogContext())
    .catch(() => undefined);
}

export type AdvanceOutcome = "completed" | "paused" | "failed" | "skipped";

/** Advance one run until it finishes, fails, or the deadline passes (then it's re-queued). */
export async function advanceRun(input: EntityRunRow, deadline: number): Promise<AdvanceOutcome> {
  const def = getSyncEntity(input.entity);
  const run = await claimRun(input);
  if (!run) return "skipped";
  const finish = async (
    status: RunStatus,
    patch: Partial<EntityRunRow>,
    statePatch: Partial<EntityStateRow>,
  ) => {
    const finishedAt = nowIso();
    await checkpoint(run, { ...patch, status, finished_at: finishedAt, lease_id: null });
    await patchState(run.entity, {
      status: status === "cancelled" ? "ready" : (status as StoredEntityStatus),
      last_finished_at: finishedAt,
      last_run_id: run.id,
      ...statePatch,
    });
  };
  if (!def) {
    await finish("failed", { error: "Unknown dataset", error_code: "UNKNOWN" }, {});
    return "failed";
  }
  if (!getJobTreadConfig()) {
    const message = "JobTread isn't connected (JOBTREAD_GRANT_KEY is not set).";
    await finish(
      "failed",
      { error: message, error_code: "NOT_CONFIGURED" },
      { last_error: message, last_error_code: "NOT_CONFIGURED" },
    );
    return "failed";
  }
  const state = await getEntityState(run.entity);
  if (!state.enabled) {
    await checkpoint(run, {
      status: "cancelled",
      finished_at: nowIso(),
      error: "Dataset disabled",
      lease_id: null,
    });
    await patchState(run.entity, { status: "disabled" });
    return "skipped";
  }
  await patchState(run.entity, {
    status: "running",
    last_run_id: run.id,
    last_started_at: run.started_at,
  });
  const stats = newStats();
  let pages = run.pages;
  let seen = run.records_seen;
  let upserted = run.records_upserted;
  try {
    if (def.kind === "core") {
      const r = await runCoreEntity(def.key, stats, run.triggered_by);
      await finish(
        "completed",
        {
          pages: 1,
          records_seen: r.seen,
          records_upserted: r.seen,
          records_removed: r.removed,
          api_requests: stats.requests,
          error: null,
          error_code: null,
        },
        {
          last_success_at: nowIso(),
          records_cached: r.seen,
          last_error: null,
          last_error_code: null,
        },
      );
      await invalidateReportCaches(def.key);
      return "completed";
    }

    const allowedFields = await allowedFieldMap();
    const dropped = [...state.dropped_fields];
    const onDrop = async () => patchState(def.key, { dropped_fields: [...dropped] });
    let cursor = run.cursor;
    for (;;) {
      if (Date.now() >= deadline) {
        // Hand off: keep the cursor and re-queue for the continuation job.
        const kept = await checkpoint(run, {
          status: "queued",
          cursor,
          pages,
          records_seen: seen,
          records_upserted: upserted,
          api_requests: run.api_requests + stats.requests,
          lease_id: null,
        });
        if (kept) await patchState(def.key, { status: "queued" });
        return "paused";
      }
      const page = await fetchPage(def, cursor, dropped, stats, onDrop);
      const syncedAt = nowIso();
      const rows = page.nodes.map((n) => def.normalize!(n, { syncedAt, allowedFields }));
      for (let i = 0; i < rows.length; i += 100)
        await agentDb().upsert(def.table, rows.slice(i, i + 100), ["id"]);
      pages++;
      seen += rows.length;
      upserted += rows.length;
      cursor = page.nextPage;
      const ok = await checkpoint(run, {
        cursor,
        pages,
        records_seen: seen,
        records_upserted: upserted,
        api_requests: run.api_requests + stats.requests,
      });
      if (!ok) return "skipped"; // another worker took over the lease
      if (!cursor) break;
    }

    // Final page done: reconcile, unless the source shrank suspiciously.
    const previous = state.records_cached ?? 0;
    const shrank = previous > 0 && seen < previous * SHRINK_GUARD_RATIO;
    const removed = shrank ? 0 : await reconcile(def.table, run.generation!);
    const warning = shrank
      ? `JobTread returned ${seen} records (previously ${previous}). Kept the cached records instead of removing them — check the grant and run again.`
      : null;
    await finish(
      "completed",
      {
        cursor: null,
        pages,
        records_seen: seen,
        records_upserted: upserted,
        records_removed: removed,
        api_requests: run.api_requests + stats.requests,
        error: warning,
        error_code: shrank ? "SHRINK_GUARD" : null,
      },
      {
        last_success_at: nowIso(),
        records_cached: shrank ? Math.max(previous, seen) : seen,
        last_error: warning,
        last_error_code: shrank ? "SHRINK_GUARD" : null,
      },
    );
    await invalidateReportCaches(def.key);
    return "completed";
  } catch (error) {
    const c = classifySyncError(error);
    // Pages already cached stay cached; nothing is removed. Retry resumes from the cursor.
    const status: RunStatus =
      c.status === "permission_blocked" ? c.status : pages > 0 ? "partial" : "failed";
    await finish(
      status,
      {
        pages,
        records_seen: seen,
        records_upserted: upserted,
        api_requests: run.api_requests + stats.requests,
        error: c.message,
        error_code: c.code,
      },
      { last_error: c.message, last_error_code: c.code },
    );
    if (error instanceof JobTreadError && error.code === "AUTH_FAILED") {
      await agentDb()
        .update("jt_connection", [eq("id", "default")], { status: "error", last_error: c.message })
        .catch(() => undefined);
    }
    return "failed";
  }
}

/** Durable job entry point (`jobtread_sync` with metadata.mode = "entities"). */
export async function processEntitySyncJob(
  metadata: Record<string, unknown>,
  options: { budgetMs?: number } = {},
): Promise<{ done: boolean; continuationJobId: string | null; outcomes: Record<string, string> }> {
  const batchId = typeof metadata.batchId === "string" ? metadata.batchId : null;
  if (!batchId) throw new Error("Sync job is missing its batch id.");
  const deadline = Date.now() + (options.budgetMs ?? STEP_BUDGET_MS);
  const outcomes: Record<string, string> = {};
  const runs = await listEntityRuns({ batchId, status: ACTIVE, limit: 100 });
  const order = orderByDependencies(runs.map((r) => r.entity));
  for (const entity of order) {
    if (Date.now() >= deadline) break;
    const run = runs.find((r) => r.entity === entity)!;
    outcomes[entity] = await advanceRun(run, deadline);
  }
  const remaining = await listEntityRuns({ batchId, status: ACTIVE, limit: 100 });
  // Runs another live worker holds are left to it; everything else continues in a new job.
  const continuing = remaining.filter((r) => r.status === "queued" || isAbandoned(r));
  if (!continuing.length)
    return { done: remaining.length === 0, continuationJobId: null, outcomes };
  const { enqueueJob } = await import("@/lib/jobs/queue");
  const job = await enqueueJob({
    jobType: "jobtread_sync",
    metadata: { mode: "entities", batchId, source: "continuation" },
  });
  await agentDb().update(
    "jt_sync_entity_runs",
    [eq("batch_id", batchId), inList("status", ACTIVE)],
    {
      job_id: job.id,
    },
  );
  return { done: false, continuationJobId: job.id, outcomes };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** The most recent scheduled instant at or before `now` (daily at `hourUtc`:00 UTC). */
export function lastScheduledInstant(now: Date, hourUtc: number): Date {
  const due = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0),
  );
  if (due.getTime() > now.getTime()) due.setUTCDate(due.getUTCDate() - 1);
  return due;
}

export function nextScheduledInstant(now: Date, hourUtc: number): Date {
  const next = lastScheduledInstant(now, hourUtc);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Re-queue batches whose runs were abandoned (worker crashed or timed out). */
export async function resumeAbandonedRuns(now = Date.now()): Promise<number> {
  const active = await listEntityRuns({ status: ACTIVE, limit: 200 });
  // Queued runs normally start within one sweep; 30 quiet minutes means the job was lost.
  const stuck = active.filter(
    (r) =>
      isAbandoned(r, now) ||
      (r.status === "queued" &&
        now - new Date(r.heartbeat_at ?? r.created_at).getTime() > 30 * 60_000),
  );
  const batches = [...new Set(stuck.map((r) => r.batch_id))];
  if (!batches.length) return 0;
  const { enqueueJob } = await import("@/lib/jobs/queue");
  for (const batchId of batches) {
    const job = await enqueueJob({
      jobType: "jobtread_sync",
      metadata: { mode: "entities", batchId, source: "resume" },
    });
    // Touch the heartbeat so the next sweep doesn't enqueue the same batch again.
    await agentDb().update(
      "jt_sync_entity_runs",
      [eq("batch_id", batchId), inList("status", ACTIVE)],
      { job_id: job.id, heartbeat_at: new Date(now).toISOString() },
    );
  }
  return batches.length;
}

/**
 * Called from the 2-minute job sweep. Resumes abandoned runs and, once per day at the
 * configured UTC hour, queues every enabled dataset whose schedule is "daily".
 */
export async function maybeEnqueueScheduledEntitySync(now = new Date()): Promise<{
  enqueued: boolean;
  reason: string;
  resumed?: number;
  batchId?: string | null;
}> {
  if (!getJobTreadConfig()) return { enqueued: false, reason: "JobTread not configured" };
  const resumed = await resumeAbandonedRuns(now.getTime());
  if ((process.env.JOBTREAD_DAILY_SYNC ?? "").toLowerCase() === "off")
    return { enqueued: false, reason: "JOBTREAD_DAILY_SYNC=off", resumed };
  const settings = await getSyncSettings();
  if (!settings.daily_enabled)
    return { enqueued: false, reason: "Daily sync is turned off", resumed };
  const due = lastScheduledInstant(now, settings.daily_hour_utc);
  const last = settings.last_daily_enqueued_at ? new Date(settings.last_daily_enqueued_at) : null;
  if (last && last.getTime() >= due.getTime())
    return { enqueued: false, reason: "Already queued for today", resumed };
  // Claim the slot first so overlapping sweeps can't both enqueue.
  const claimed = await agentDb().update(
    "jt_sync_settings",
    [
      eq("id", "default"),
      settings.last_daily_enqueued_at
        ? eq("last_daily_enqueued_at", settings.last_daily_enqueued_at)
        : { col: "last_daily_enqueued_at", op: "is_null" },
    ],
    { last_daily_enqueued_at: now.toISOString() },
  );
  if (!claimed.length) return { enqueued: false, reason: "Another sweep queued it", resumed };
  const states = await ensureEntityStates();
  const entities = states.filter((s) => s.enabled && s.schedule === "daily").map((s) => s.entity);
  if (!entities.length) return { enqueued: false, reason: "No datasets scheduled daily", resumed };
  const result = await requestEntitySync({ entities, triggeredBy: "schedule:daily" });
  return { enqueued: Boolean(result.batchId), reason: "daily", resumed, batchId: result.batchId };
}

/** After the legacy hourly full sync succeeds, reflect it on the core datasets. */
export async function recordCoreSyncSuccess(counts: Partial<Record<SyncEntityKey, number>>) {
  const at = nowIso();
  for (const [key, seen] of Object.entries(counts) as Array<[SyncEntityKey, number]>) {
    await patchState(key, {
      status: "completed",
      last_success_at: at,
      last_finished_at: at,
      records_cached: seen,
      last_error: null,
      last_error_code: null,
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Overview (Sync Manager UI, Data Health, Dexter)
// ---------------------------------------------------------------------------

export type EntityOverview = {
  key: SyncEntityKey;
  label: string;
  description: string;
  kind: "core" | "paged";
  sensitivity: SyncEntityDef["sensitivity"];
  privacy: string;
  usedFor: string;
  dependsOn: SyncEntityKey[];
  enabled: boolean;
  schedule: "daily" | "manual";
  status: EntityStatus;
  lastSuccessAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  recordsCached: number | null;
  /** Verified total in JobTread (Data Catalog), when known. */
  sourceCount: number | null;
  sourceVerifiedAt: string | null;
  sourceAccessible: boolean | null;
  droppedFields: string[];
  activeRun: {
    id: string;
    status: RunStatus;
    pages: number;
    recordsSeen: number;
    startedAt: string | null;
    heartbeatAt: string | null;
  } | null;
};

export function deriveStatus(
  configured: boolean,
  state: Pick<EntityStateRow, "enabled" | "status">,
): EntityStatus {
  if (!configured) return "not_configured";
  if (!state.enabled) return "disabled";
  return state.status === "disabled" ? "ready" : state.status;
}

export async function getEntityOverviews(): Promise<EntityOverview[]> {
  const configured = Boolean(getJobTreadConfig());
  const [states, active, catalog] = await Promise.all([
    ensureEntityStates(),
    listEntityRuns({ status: ACTIVE, limit: 100 }),
    agentDb()
      .select<{
        entity: string;
        record_count: number | null;
        accessible: boolean;
        last_verified_at: string;
      }>("jt_entity_catalog", {})
      .catch(() => []),
  ]);
  return states.map((s) => {
    const def = getSyncEntity(s.entity)!;
    const cat = catalog.find((c) => c.entity === def.catalogEntity);
    const run = active.find((r) => r.entity === s.entity);
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      kind: def.kind,
      sensitivity: def.sensitivity,
      privacy: def.privacy,
      usedFor: def.usedFor,
      dependsOn: def.dependsOn,
      enabled: s.enabled,
      schedule: s.schedule,
      status: deriveStatus(configured, s),
      lastSuccessAt: s.last_success_at,
      lastStartedAt: s.last_started_at,
      lastFinishedAt: s.last_finished_at,
      lastError: s.last_error,
      lastErrorCode: s.last_error_code,
      recordsCached: s.records_cached,
      sourceCount: cat?.record_count ?? null,
      sourceVerifiedAt: cat?.last_verified_at ?? null,
      sourceAccessible: cat ? cat.accessible : null,
      droppedFields: s.dropped_fields,
      activeRun: run
        ? {
            id: run.id,
            status: run.status,
            pages: run.pages,
            recordsSeen: run.records_seen,
            startedAt: run.started_at,
            heartbeatAt: run.heartbeat_at,
          }
        : null,
    };
  });
}

export async function getSyncManagerOverview() {
  const [entities, runs, settings] = await Promise.all([
    getEntityOverviews(),
    listEntityRuns({ limit: 40 }),
    getSyncSettings(),
  ]);
  const now = new Date();
  return {
    configured: Boolean(getJobTreadConfig()),
    schedule: {
      dailyEnabled: settings.daily_enabled,
      dailyHourUtc: settings.daily_hour_utc,
      lastDailyEnqueuedAt: settings.last_daily_enqueued_at,
      nextRunAt: settings.daily_enabled
        ? nextScheduledInstant(now, settings.daily_hour_utc).toISOString()
        : null,
      killSwitch: (process.env.JOBTREAD_DAILY_SYNC ?? "").toLowerCase() === "off",
    },
    entities,
    runs: runs.map((r) => ({
      id: r.id,
      entity: r.entity,
      batchId: r.batch_id,
      status: r.status,
      triggeredBy: r.triggered_by,
      jobId: r.job_id,
      pages: r.pages,
      recordsSeen: r.records_seen,
      recordsRemoved: r.records_removed,
      apiRequests: r.api_requests,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      createdAt: r.created_at,
      resumedFrom: r.resumed_from,
      error: r.error,
      errorCode: r.error_code,
    })),
  };
}
