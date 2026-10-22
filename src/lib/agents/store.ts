/**
 * Minimal table access for the AI Workforce — service-role Supabase in production,
 * an in-memory store for unit tests and ENABLE_MOCK_RESEARCH (same switch as surveys).
 *
 * Callers are responsible for authorization; this module only stores.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export type Row = Record<string, unknown>;

export type Filter =
  | { col: string; op: "eq" | "neq" | "gte" | "lte" | "lt" | "gt"; value: unknown }
  | { col: string; op: "in"; value: unknown[] }
  | { col: string; op: "is_null" | "not_null" };

export type Query = {
  filters?: Filter[];
  order?: { col: string; ascending?: boolean };
  limit?: number;
  columns?: string;
};

export const eq = (col: string, value: unknown): Filter => ({ col, op: "eq", value });
export const inList = (col: string, value: unknown[]): Filter => ({ col, op: "in", value });

export class StoreError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof StoreError && error.code === "23505";
}

/** Tables with unique constraints the memory store must honor (mirrors 067_ai_workforce.sql). */
const MEMORY_UNIQUE: Record<string, string[][]> = {
  ai_departments: [["slug"]],
  ai_agents: [["slug"]],
  ai_agent_config_versions: [["agent_id", "version_number"]],
  ai_agent_access_policies: [["agent_id", "principal_type", "principal_value", "access_level"]],
  ai_tasks: [["idempotency_key"]],
  ai_agent_runtime_status: [["agent_id"]],
  ai_knowledge_document_agents: [["document_id", "agent_id"]],
  ai_workspace_settings: [["id"]],
};

const NO_ID_TABLES = new Set([
  "ai_agent_runtime_status",
  "ai_knowledge_document_agents",
  "ai_workspace_settings",
]);
const NO_UPDATED_AT = new Set([
  "ai_agent_config_versions",
  "ai_agent_access_policies",
  "ai_task_events",
  "ai_knowledge_document_agents",
  "ai_knowledge_chunks",
  "ai_onboarding_template_steps",
  "ai_audit_log",
]);

type MemoryState = { tables: Map<string, Row[]> };
const globalMemory = globalThis as typeof globalThis & { __baxterAgentStore?: MemoryState };

function memory(): MemoryState {
  if (!globalMemory.__baxterAgentStore) globalMemory.__baxterAgentStore = { tables: new Map() };
  return globalMemory.__baxterAgentStore;
}

export function resetAgentStoreForTests(): void {
  globalMemory.__baxterAgentStore = { tables: new Map() };
}

export function usesAgentMemoryStore(): boolean {
  try {
    const env = getEnv();
    return (
      (Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production") ||
      Boolean(env.E2E_TEST_AUTH_BYPASS)
    );
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return String(a) < String(b) ? -1 : 1;
}

function matches(row: Row, filters: Filter[] = []): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case "eq":
        return v === f.value;
      case "neq":
        return v !== f.value;
      case "in":
        return f.value.includes(v);
      case "is_null":
        return v == null;
      case "not_null":
        return v != null;
      case "gte":
        return compare(v, f.value) >= 0;
      case "lte":
        return compare(v, f.value) <= 0;
      case "gt":
        return compare(v, f.value) > 0;
      case "lt":
        return compare(v, f.value) < 0;
    }
  });
}

function table(name: string): Row[] {
  const tables = memory().tables;
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name)!;
}

function assertMemoryUnique(name: string, candidate: Row, ignore?: Row) {
  for (const cols of MEMORY_UNIQUE[name] ?? []) {
    if (cols.some((c) => candidate[c] == null)) continue;
    const clash = table(name).find((r) => r !== ignore && cols.every((c) => r[c] === candidate[c]));
    if (clash) throw new StoreError(`Duplicate value in ${name} (${cols.join(", ")})`, "23505");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const memoryDb = {
  async select<T>(name: string, q: Query = {}): Promise<T[]> {
    let rows = table(name).filter((r) => matches(r, q.filters));
    if (q.order) {
      const { col, ascending = true } = q.order;
      rows = [...rows].sort((a, b) => compare(a[col], b[col]) * (ascending ? 1 : -1));
    }
    if (q.limit != null) rows = rows.slice(0, q.limit);
    return clone(rows) as T[];
  },
  async insert<T>(name: string, input: Row | Row[]): Promise<T[]> {
    const rows = Array.isArray(input) ? input : [input];
    const out: Row[] = [];
    for (const r of rows) {
      const row: Row = { ...r };
      if (!NO_ID_TABLES.has(name) && row.id == null) row.id = randomUUID();
      if (row.created_at == null && name !== "ai_agent_runtime_status") row.created_at = nowIso();
      if (!NO_UPDATED_AT.has(name) && row.updated_at == null) row.updated_at = nowIso();
      assertMemoryUnique(name, row);
      table(name).push(row);
      out.push(row);
    }
    return clone(out) as T[];
  },
  async update<T>(name: string, filters: Filter[], patch: Row): Promise<T[]> {
    const out: Row[] = [];
    for (const row of table(name)) {
      if (!matches(row, filters)) continue;
      const next = { ...row, ...patch };
      if (!NO_UPDATED_AT.has(name)) next.updated_at = nowIso();
      assertMemoryUnique(name, next, row);
      Object.assign(row, next);
      out.push(row);
    }
    return clone(out) as T[];
  },
  async upsert<T>(name: string, input: Row | Row[], onConflict: string[]): Promise<T[]> {
    const rows = Array.isArray(input) ? input : [input];
    const out: T[] = [];
    for (const r of rows) {
      const existing = table(name).find((row) => onConflict.every((c) => row[c] === r[c]));
      if (existing) {
        out.push(
          ...(await memoryDb.update<T>(
            name,
            onConflict.map((c) => eq(c, r[c])),
            r,
          )),
        );
      } else {
        out.push(...(await memoryDb.insert<T>(name, r)));
      }
    }
    return out;
  },
  async remove(name: string, filters: Filter[]): Promise<number> {
    const rows = table(name);
    const keep = rows.filter((r) => !matches(r, filters));
    const removed = rows.length - keep.length;
    memory().tables.set(name, keep);
    return removed;
  },
};

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

type PgBuilder = {
  eq: (c: string, v: unknown) => PgBuilder;
  neq: (c: string, v: unknown) => PgBuilder;
  gte: (c: string, v: unknown) => PgBuilder;
  lte: (c: string, v: unknown) => PgBuilder;
  gt: (c: string, v: unknown) => PgBuilder;
  lt: (c: string, v: unknown) => PgBuilder;
  in: (c: string, v: unknown[]) => PgBuilder;
  is: (c: string, v: null) => PgBuilder;
  not: (c: string, op: string, v: null) => PgBuilder;
  order: (c: string, o: { ascending: boolean }) => PgBuilder;
  limit: (n: number) => PgBuilder;
} & PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

function applyFilters(builder: PgBuilder, filters: Filter[] = []): PgBuilder {
  let b = builder;
  for (const f of filters) {
    switch (f.op) {
      case "in":
        b = b.in(f.col, f.value);
        break;
      case "is_null":
        b = b.is(f.col, null);
        break;
      case "not_null":
        b = b.not(f.col, "is", null);
        break;
      default:
        b = b[f.op](f.col, f.value);
    }
  }
  return b;
}

function raise(name: string, error: { message: string; code?: string }): never {
  throw new StoreError(`${name}: ${error.message}`, error.code ?? "DB_ERROR");
}

const supabaseDb = {
  async select<T>(name: string, q: Query = {}): Promise<T[]> {
    const client = createServiceClient();
    let b = applyFilters(
      client.from(name).select(q.columns ?? "*") as unknown as PgBuilder,
      q.filters,
    );
    if (q.order) b = b.order(q.order.col, { ascending: q.order.ascending ?? true });
    if (q.limit != null) b = b.limit(q.limit);
    const { data, error } = await b;
    if (error) raise(name, error);
    return (data ?? []) as T[];
  },
  async insert<T>(name: string, input: Row | Row[]): Promise<T[]> {
    const { data, error } = await createServiceClient().from(name).insert(input).select("*");
    if (error) raise(name, error);
    return (data ?? []) as T[];
  },
  async update<T>(name: string, filters: Filter[], patch: Row): Promise<T[]> {
    const b = applyFilters(
      createServiceClient().from(name).update(patch) as unknown as PgBuilder,
      filters,
    ) as unknown as { select: (c: string) => PgBuilder };
    const { data, error } = await b.select("*");
    if (error) raise(name, error);
    return (data ?? []) as T[];
  },
  async upsert<T>(name: string, input: Row | Row[], onConflict: string[]): Promise<T[]> {
    const { data, error } = await createServiceClient()
      .from(name)
      .upsert(input, { onConflict: onConflict.join(",") })
      .select("*");
    if (error) raise(name, error);
    return (data ?? []) as T[];
  },
  async remove(name: string, filters: Filter[]): Promise<number> {
    const b = applyFilters(
      createServiceClient().from(name).delete({ count: "exact" }) as unknown as PgBuilder,
      filters,
    );
    const { error, count } = (await b) as unknown as {
      error: { message: string; code?: string } | null;
      count: number | null;
    };
    if (error) raise(name, error);
    return count ?? 0;
  },
};

export type AgentDb = typeof memoryDb;

export function agentDb(): AgentDb {
  return usesAgentMemoryStore() ? memoryDb : supabaseDb;
}

/** Postgres function call (Supabase only; memory-mode callers must branch first). */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (usesAgentMemoryStore())
    throw new StoreError(`RPC ${fn} unavailable in memory mode`, "NO_RPC");
  const { data, error } = await createServiceClient().rpc(fn, args);
  if (error) raise(fn, error);
  return data as T;
}

export async function selectOne<T>(name: string, q: Query): Promise<T | null> {
  const rows = await agentDb().select<T>(name, { ...q, limit: 1 });
  return rows[0] ?? null;
}
