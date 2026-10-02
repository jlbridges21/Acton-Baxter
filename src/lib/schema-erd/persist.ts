import type { SchemaPoint } from "@/lib/schema-erd/types";

/** Canvas filter for tables no enabled tool claims. Not a `BAXTER_TOOLS` key. */
export const SCHEMA_ERD_UNASSIGNED = "unassigned";

export type ErdPersisted = {
  positions: Record<string, SchemaPoint>;
  expanded: string[];
  hiddenGroups: string[];
  search: string;
  focus: string | null;
  /** Tool key, {@link SCHEMA_ERD_UNASSIGNED}, or null for every table. */
  tool: string | null;
};

export function schemaErdStorageKey(userId: string): string {
  return `baxter.schema-erd.v1:${userId}`;
}

export function parseErdPersisted(
  raw: unknown,
  knownTables: ReadonlySet<string>,
  knownGroups: ReadonlySet<string>,
  knownToolKeys: ReadonlySet<string> = new Set(),
): ErdPersisted | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!value.positions || typeof value.positions !== "object" || Array.isArray(value.positions)) {
    return null;
  }
  const positions: Record<string, SchemaPoint> = {};
  for (const [name, point] of Object.entries(value.positions)) {
    if (!knownTables.has(name)) return null;
    if (!point || typeof point !== "object" || Array.isArray(point)) return null;
    const x = (point as { x?: unknown }).x;
    const y = (point as { y?: unknown }).y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }
    positions[name] = { x, y };
  }
  if (!Array.isArray(value.expanded)) return null;
  if (value.expanded.some((item) => typeof item !== "string" || !knownTables.has(item)))
    return null;
  if (!Array.isArray(value.hiddenGroups)) return null;
  if (value.hiddenGroups.some((item) => typeof item !== "string" || !knownGroups.has(item))) {
    return null;
  }
  if (typeof value.search !== "string") return null;
  if (value.focus !== null && (typeof value.focus !== "string" || !knownTables.has(value.focus))) {
    return null;
  }
  return {
    positions,
    expanded: value.expanded as string[],
    hiddenGroups: value.hiddenGroups as string[],
    search: value.search,
    focus: value.focus as string | null,
    tool: persistedTool(value.tool, knownToolKeys),
  };
}

/**
 * A missing field is every table. An unknown key falls back to every table
 * without discarding the rest of the saved arrangement.
 */
function persistedTool(value: unknown, knownToolKeys: ReadonlySet<string>): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  if (value === SCHEMA_ERD_UNASSIGNED || knownToolKeys.has(value)) return value;
  return null;
}

export function readErdView(
  storage: Pick<Storage, "getItem">,
  userId: string,
  knownTables: ReadonlySet<string>,
  knownGroups: ReadonlySet<string>,
  knownToolKeys: ReadonlySet<string> = new Set(),
): ErdPersisted | null {
  try {
    const raw = storage.getItem(schemaErdStorageKey(userId));
    if (!raw) return null;
    return parseErdPersisted(JSON.parse(raw), knownTables, knownGroups, knownToolKeys);
  } catch {
    return null;
  }
}

export function writeErdView(
  storage: Pick<Storage, "setItem">,
  userId: string,
  view: ErdPersisted,
): void {
  try {
    storage.setItem(schemaErdStorageKey(userId), JSON.stringify(view));
  } catch {
    // Private mode and quota failures keep the in-memory arrangement.
  }
}

/** Saved cards keep their coordinates. Tables added later keep the automatic spot. */
export function placedPositions(
  automatic: Readonly<Record<string, SchemaPoint>>,
  saved: Readonly<Record<string, SchemaPoint>> | null,
): Record<string, SchemaPoint> {
  const next = { ...automatic };
  if (!saved) return next;
  for (const [name, point] of Object.entries(saved)) {
    if (next[name]) next[name] = point;
  }
  return next;
}
