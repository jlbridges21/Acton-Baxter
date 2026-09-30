import { INVENTORY_COLUMN_IDS, type InventoryColumnId } from "@/lib/inventory/column-widths";

/** Pointer travel before a header press becomes a reorder instead of a sort click. */
export const INVENTORY_COLUMN_REORDER_DISTANCE = 8;

/** Per-viewer inventory column order, stored in this browser. The checkbox column stays first. */
export const INVENTORY_COLUMN_ORDER_KEY = "baxter.inventory.column-order";

export type InventoryMovableColumnId = Exclude<InventoryColumnId, "select">;

const DEFAULT_ORDER: InventoryMovableColumnId[] = INVENTORY_COLUMN_IDS.filter(
  (id): id is InventoryMovableColumnId => id !== "select",
);

const MOVABLE = new Set<string>(DEFAULT_ORDER);

const listeners = new Set<() => void>();

let cached: InventoryMovableColumnId[] = DEFAULT_ORDER;
let cachedRaw = "";

function isMovable(value: string): value is InventoryMovableColumnId {
  return MOVABLE.has(value);
}

function parse(raw: string): InventoryMovableColumnId[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return DEFAULT_ORDER;
  }
  if (!Array.isArray(parsed)) return DEFAULT_ORDER;
  const ids = parsed.filter(
    (value): value is InventoryMovableColumnId => typeof value === "string" && isMovable(value),
  );
  if (ids.length !== DEFAULT_ORDER.length || new Set(ids).size !== DEFAULT_ORDER.length) {
    return DEFAULT_ORDER;
  }
  return ids;
}

export function subscribeInventoryColumnOrder(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInventoryColumnOrder(): InventoryMovableColumnId[] {
  const raw = window.localStorage.getItem(INVENTORY_COLUMN_ORDER_KEY) ?? "";
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = raw ? parse(raw) : DEFAULT_ORDER;
  return cached;
}

export function getServerInventoryColumnOrder(): InventoryMovableColumnId[] {
  return DEFAULT_ORDER;
}

export function setInventoryColumnOrder(order: InventoryMovableColumnId[]) {
  const raw = JSON.stringify(order);
  window.localStorage.setItem(INVENTORY_COLUMN_ORDER_KEY, raw);
  cachedRaw = raw;
  cached = order;
  for (const listener of listeners) listener();
}

export function resetInventoryColumnOrder() {
  window.localStorage.removeItem(INVENTORY_COLUMN_ORDER_KEY);
  cachedRaw = "";
  cached = DEFAULT_ORDER;
  for (const listener of listeners) listener();
}
