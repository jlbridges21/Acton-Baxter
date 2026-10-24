/**
 * JobTread → reporting cache synchronization.
 *
 * Strategy: full reconciliation. Acton's dataset (~450 jobs, ~80 catalog models) syncs in
 * roughly 10–20 API calls, so we re-read everything each run instead of trusting change
 * timestamps (JobTread jobs don't expose a reliable "updatedAt"). Rows not seen in a
 * successful run are soft-removed (removed_at), never hard-deleted.
 *
 * Only reporting fields are cached: job attributes, job/location/customer custom-field
 * values (minus fields an admin marked "excluded"), and catalog model totals.
 * No contacts, emails, phones, files, or line items.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";
import {
  getJobTreadConfig,
  JobTreadError,
  newStats,
  paginate,
  pave,
  type PaveStats,
} from "./client";
import { listCustomFields, syncCustomFieldMetadata } from "./metadata";

type CfNode = { id: string; value: unknown; customField: { id: string } };
type CfConn = { nodes: CfNode[] };

export type JobNode = {
  id: string;
  name: string;
  number: string | null;
  createdAt: string | null;
  closedOn: string | null;
  projectedPrice?: number | null;
  projectedCost?: number | null;
  actualCost?: number | null;
  taskSummary?: {
    startDate: string | null;
    endDate: string | null;
    progress: number | null;
  } | null;
  customFieldValues?: CfConn;
  location?: {
    id: string;
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    customFieldValues?: CfConn;
    account?: { id: string; name: string | null; customFieldValues?: CfConn } | null;
  } | null;
};

const CF_NODES = { $: { size: 60 }, nodes: { id: {}, value: {}, customField: { id: {} } } };

export const JOB_SYNC_NODES = {
  id: {},
  name: {},
  number: {},
  createdAt: {},
  closedOn: {},
  projectedPrice: {},
  projectedCost: {},
  actualCost: {},
  taskSummary: { startDate: {}, endDate: {}, progress: {} },
  customFieldValues: CF_NODES,
  location: {
    id: {},
    name: {},
    address: {},
    city: {},
    state: {},
    postalCode: {},
    customFieldValues: CF_NODES,
    account: { id: {}, name: {}, customFieldValues: CF_NODES },
  },
};

/** Multi-value option fields repeat; values are kept as string arrays in source order. */
export function collectValues(
  conn: CfConn | undefined,
  allowed: Set<string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const node of conn?.nodes ?? []) {
    const fieldId = node.customField?.id;
    if (!fieldId || !allowed.has(fieldId)) continue;
    if (node.value === null || node.value === undefined || node.value === "") continue;
    const value = typeof node.value === "object" ? JSON.stringify(node.value) : String(node.value);
    (out[fieldId] ??= []).push(value);
  }
  return out;
}

const toNumber = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

export function normalizeJob(node: JobNode, allowed: Set<string>, syncedAt: string) {
  const loc = node.location ?? null;
  return {
    id: node.id,
    number: node.number ?? null,
    name: node.name,
    source_created_at: node.createdAt ?? null,
    closed_on: node.closedOn ?? null,
    location_id: loc?.id ?? null,
    location_name: loc?.name ?? null,
    address: loc?.address ?? null,
    city: loc?.city ?? null,
    state: loc?.state ?? null,
    postal_code: loc?.postalCode ?? null,
    customer_id: loc?.account?.id ?? null,
    customer_name: loc?.account?.name ?? null,
    projected_price: toNumber(node.projectedPrice),
    projected_cost: toNumber(node.projectedCost),
    actual_cost: toNumber(node.actualCost),
    task_start: node.taskSummary?.startDate ?? null,
    task_end: node.taskSummary?.endDate ?? null,
    task_progress:
      typeof node.taskSummary?.progress === "number" ? node.taskSummary.progress : null,
    job_fields: collectValues(node.customFieldValues, allowed),
    location_fields: collectValues(loc?.customFieldValues, allowed),
    customer_fields: collectValues(loc?.account?.customFieldValues, allowed),
    synced_at: syncedAt,
    removed_at: null,
  };
}

async function upsertRemovingMissing(
  table: string,
  rows: Array<Record<string, unknown> & { id: string }>,
  syncedAt: string,
) {
  const db = agentDb();
  for (let i = 0; i < rows.length; i += 100) {
    await db.upsert(table, rows.slice(i, i + 100), ["id"]);
  }
  const existing = await db.select<{ id: string; removed_at: string | null }>(table, {
    filters: [{ col: "removed_at", op: "is_null" }],
    columns: "id, removed_at",
  });
  const seen = new Set(rows.map((r) => r.id));
  let removed = 0;
  for (const row of existing) {
    if (!seen.has(row.id)) {
      removed++;
      await db.update(table, [eq("id", row.id)], { removed_at: syncedAt });
    }
  }
  return removed;
}

export async function syncJobs(stats: PaveStats): Promise<{ seen: number; removed: number }> {
  const fields = await listCustomFields();
  const allowed = new Set(fields.filter((f) => f.category !== "excluded").map((f) => f.id));
  const nodes = await paginate<JobNode>({
    connection: "jobs",
    nodes: JOB_SYNC_NODES,
    pageSize: 25,
    stats,
  });
  const syncedAt = new Date().toISOString();
  const rows = nodes.map((n) => normalizeJob(n, allowed, syncedAt));
  const removed = await upsertRemovingMissing("jt_jobs", rows, syncedAt);
  return { seen: rows.length, removed };
}

type DocumentNode = {
  id: string;
  type: string;
  status: string | null;
  number: string | null;
  name: string | null;
  issueDate: string | null;
  dueDate: string | null;
  signedAt: string | null;
  createdAt: string | null;
  price: number | null;
  cost: number | null;
  tax: number | null;
  amountPaid: number | null;
  balance: number | null;
  job: { id: string } | null;
};

/** Financial documents (orders, invoices, bills): totals and dates only — no line items. */
export async function syncDocuments(stats: PaveStats): Promise<{ seen: number; removed: number }> {
  const nodes = await paginate<DocumentNode>({
    connection: "documents",
    nodes: {
      id: {},
      type: {},
      status: {},
      number: {},
      name: {},
      issueDate: {},
      dueDate: {},
      signedAt: {},
      createdAt: {},
      price: {},
      cost: {},
      tax: {},
      amountPaid: {},
      balance: {},
      job: { id: {} },
    },
    pageSize: 100,
    stats,
  });
  const syncedAt = new Date().toISOString();
  const rows = nodes.map((n) => ({
    id: n.id,
    job_id: n.job?.id ?? null,
    type: n.type,
    status: n.status,
    number: n.number,
    name: n.name,
    issue_date: n.issueDate?.slice(0, 10) ?? null,
    due_date: n.dueDate?.slice(0, 10) ?? null,
    signed_at: n.signedAt,
    price: toNumber(n.price),
    cost: toNumber(n.cost),
    tax: toNumber(n.tax),
    amount_paid: toNumber(n.amountPaid),
    balance: toNumber(n.balance),
    source_created_at: n.createdAt,
    synced_at: syncedAt,
    removed_at: null,
  }));
  const removed = await upsertRemovingMissing("jt_documents", rows, syncedAt);
  return { seen: rows.length, removed };
}

type ModelNode = {
  id: string;
  name: string;
  description: string | null;
  descendentCostItems: { count: number; totalCost: number | null; totalPrice: number | null };
};

/** Top-level catalog cost groups (ADU models, templates) with server-side totals. */
export async function syncCatalogModels(
  stats: PaveStats,
): Promise<{ seen: number; removed: number }> {
  const nodes = await paginate<ModelNode>({
    connection: "costGroups",
    args: {
      where: {
        and: [
          [["job", "id"], "=", null],
          [["parentCostGroup", "id"], "=", null],
        ],
      },
    },
    nodes: {
      id: {},
      name: {},
      description: {},
      descendentCostItems: {
        count: {},
        totalCost: { _: "sum", $: "cost" },
        totalPrice: { _: "sum", $: "price" },
      },
    },
    pageSize: 50,
    stats,
  });
  const syncedAt = new Date().toISOString();
  const rows = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    item_count: n.descendentCostItems?.count ?? 0,
    total_cost: toNumber(n.descendentCostItems?.totalCost),
    total_price: toNumber(n.descendentCostItems?.totalPrice),
    synced_at: syncedAt,
    removed_at: null,
  }));
  const removed = await upsertRemovingMissing("jt_catalog_models", rows, syncedAt);
  return { seen: rows.length, removed };
}

export type ConnectionRow = {
  id: "default";
  organization_id: string | null;
  organization_name: string | null;
  grant_name: string | null;
  grant_expires_at: string | null;
  grant_is_unrestricted: boolean | null;
  status: "unknown" | "connected" | "error" | "not_configured";
  last_tested_at: string | null;
  last_error: string | null;
  sync_interval_minutes: number;
  updated_at: string;
};

export async function getConnectionRow(): Promise<ConnectionRow> {
  const row = await selectOne<ConnectionRow>("jt_connection", { filters: [eq("id", "default")] });
  return (
    row ?? {
      id: "default",
      organization_id: null,
      organization_name: null,
      grant_name: null,
      grant_expires_at: null,
      grant_is_unrestricted: null,
      status: "unknown",
      last_tested_at: null,
      last_error: null,
      sync_interval_minutes: 60,
      updated_at: new Date(0).toISOString(),
    }
  );
}

async function saveConnection(patch: Partial<ConnectionRow>) {
  const current = await getConnectionRow();
  await agentDb().upsert(
    "jt_connection",
    { ...current, ...patch, id: "default", updated_at: new Date().toISOString() },
    ["id"],
  );
}

/** Verify the grant and organization. Never returns or stores the key. */
export async function testConnection(): Promise<ConnectionRow> {
  const config = getJobTreadConfig();
  if (!config) {
    await saveConnection({
      status: "not_configured",
      last_tested_at: new Date().toISOString(),
      last_error: null,
    });
    return getConnectionRow();
  }
  try {
    const res = await pave<{
      currentGrant: { name: string; expiresAt: string; allowedActions: string[] | null } | null;
      organization: { id: string; name: string } | null;
    }>({
      currentGrant: { id: {}, name: {}, expiresAt: {}, allowedActions: {} },
      organization: { $: { id: config.organizationId }, id: {}, name: {} },
    });
    if (!res.organization)
      throw new JobTreadError("This grant can't see the configured organization.", "AUTH_FAILED");
    await saveConnection({
      status: "connected",
      organization_id: res.organization.id,
      organization_name: res.organization.name,
      grant_name: res.currentGrant?.name ?? null,
      grant_expires_at: res.currentGrant?.expiresAt ?? null,
      grant_is_unrestricted: res.currentGrant ? res.currentGrant.allowedActions === null : null,
      last_tested_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error) {
    await saveConnection({
      status: "error",
      last_tested_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message.slice(0, 300) : "Connection failed",
    });
  }
  return getConnectionRow();
}

export type SyncRunRow = {
  id: string;
  kind: "metadata" | "jobs" | "catalog" | "full";
  status: "running" | "succeeded" | "failed";
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  api_requests: number;
  records_seen: number;
  records_upserted: number;
  records_removed: number;
  duration_ms: number | null;
  error: string | null;
};

export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  return agentDb().select<SyncRunRow>("jt_sync_runs", {
    order: { col: "started_at", ascending: false },
    limit,
  });
}

export async function lastSuccessfulSync(): Promise<SyncRunRow | null> {
  const [row] = await agentDb().select<SyncRunRow>("jt_sync_runs", {
    filters: [eq("status", "succeeded"), { col: "kind", op: "in", value: ["full", "jobs"] }],
    order: { col: "started_at", ascending: false },
    limit: 1,
  });
  return row ?? null;
}

const STALE_RUN_MS = 10 * 60_000;

/** Run metadata + jobs + catalog sync. Skips if another run started in the last 10 minutes. */
export async function runFullSync(triggeredBy: string): Promise<SyncRunRow> {
  const db = agentDb();
  const [running] = await db.select<SyncRunRow>("jt_sync_runs", {
    filters: [eq("status", "running")],
    order: { col: "started_at", ascending: false },
    limit: 1,
  });
  if (running && Date.now() - new Date(running.started_at).getTime() < STALE_RUN_MS) return running;
  if (running) {
    await db.update("jt_sync_runs", [eq("id", running.id)], {
      status: "failed",
      error: "Interrupted",
      finished_at: new Date().toISOString(),
    });
  }
  const started = Date.now();
  const [run] = await db.insert<SyncRunRow>("jt_sync_runs", {
    kind: "full",
    status: "running",
    triggered_by: triggeredBy,
    started_at: new Date().toISOString(),
    api_requests: 0,
    records_seen: 0,
    records_upserted: 0,
    records_removed: 0,
  });
  const stats = newStats();
  try {
    await testConnection();
    const meta = await syncCustomFieldMetadata(stats);
    const jobs = await syncJobs(stats);
    const catalog = await syncCatalogModels(stats);
    const documents = await syncDocuments(stats);
    // The entity catalog is metadata; refresh daily. Its failure never fails the data sync.
    const { entityCatalogIsStale, verifyEntityCatalog } = await import("./catalog");
    if (await entityCatalogIsStale().catch(() => false))
      await verifyEntityCatalog(stats).catch(() => undefined);
    const [done] = await db.update<SyncRunRow>("jt_sync_runs", [eq("id", run!.id)], {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      api_requests: stats.requests,
      records_seen: meta.seen + jobs.seen + catalog.seen + documents.seen,
      records_upserted: jobs.seen + catalog.seen + documents.seen,
      records_removed: jobs.removed + catalog.removed + meta.removed + documents.removed,
      duration_ms: Date.now() - started,
    });
    // Keep Global Search's JobTread index (and direct-read cache) in step. Never fails the sync.
    await import("@/lib/search/providers/indexed")
      .then((m) => m.invalidateSourceDocs())
      .catch(() => undefined);
    for (const provider of ["jobtread-jobs", "jobtread-documents"]) {
      await import("@/lib/search/admin")
        .then((m) => m.reindexProviderById(provider, "jobtread-sync"))
        .catch(() => undefined);
    }
    return done!;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Sync failed";
    const [failed] = await db.update<SyncRunRow>("jt_sync_runs", [eq("id", run!.id)], {
      status: "failed",
      finished_at: new Date().toISOString(),
      api_requests: stats.requests,
      duration_ms: Date.now() - started,
      error: message,
    });
    if (error instanceof JobTreadError && error.code === "AUTH_FAILED") {
      await saveConnection({ status: "error", last_error: message });
    }
    return failed!;
  }
}

/** Called from the existing job sweep: enqueue a sync when the interval has elapsed. */
export async function maybeEnqueueScheduledJobTreadSync(): Promise<{
  enqueued: boolean;
  reason: string;
}> {
  if (!getJobTreadConfig()) return { enqueued: false, reason: "JobTread not configured" };
  // Opt-in: scheduled syncs run only when JOBTREAD_SYNC_ENABLED=true.
  if ((process.env.JOBTREAD_SYNC_ENABLED ?? "false").toLowerCase() !== "true") {
    return { enqueued: false, reason: "JOBTREAD_SYNC_ENABLED is not true" };
  }
  const connection = await getConnectionRow();
  const [last] = await listSyncRuns(1);
  const intervalMs = (connection.sync_interval_minutes || 60) * 60_000;
  if (last && Date.now() - new Date(last.started_at).getTime() < intervalMs) {
    return { enqueued: false, reason: "Sync interval not elapsed" };
  }
  const { enqueueJob } = await import("@/lib/jobs/queue");
  await enqueueJob({ jobType: "jobtread_sync", metadata: { source: "scheduled" } });
  return { enqueued: true, reason: "enqueued" };
}
