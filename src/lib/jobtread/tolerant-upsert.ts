/**
 * Upserts that keep syncing when a newer migration hasn't been applied yet: if the database
 * rejects one of the listed optional columns as unknown, the batch is retried without them
 * (and they're skipped for ten minutes), so a pending migration never breaks a sync.
 */

import "server-only";

import { agentDb, StoreError } from "@/lib/agents/store";

const missingUntil = new Map<string, number>();
const SKIP_MS = 10 * 60_000;

function unknownColumn(error: unknown): boolean {
  return (
    error instanceof StoreError &&
    (["42703", "PGRST204"].includes(error.code) ||
      /column .* does not exist|could not find the '.+' column/i.test(error.message))
  );
}

export function resetTolerantUpsertForTests() {
  missingUntil.clear();
}

export async function upsertWithOptionalColumns(
  table: string,
  rows: Array<Record<string, unknown>>,
  optional: string[],
): Promise<{ droppedColumns: string[] }> {
  if (!rows.length) return { droppedColumns: [] };
  const skip = (missingUntil.get(table) ?? 0) > Date.now();
  const strip = (r: Record<string, unknown>) => {
    const out = { ...r };
    for (const c of optional) delete out[c];
    return out;
  };
  if (!skip || !optional.length) {
    try {
      await agentDb().upsert(table, rows, ["id"]);
      return { droppedColumns: [] };
    } catch (error) {
      if (!optional.length || !unknownColumn(error)) throw error;
      missingUntil.set(table, Date.now() + SKIP_MS);
    }
  }
  await agentDb().upsert(table, rows.map(strip), ["id"]);
  return { droppedColumns: optional };
}
