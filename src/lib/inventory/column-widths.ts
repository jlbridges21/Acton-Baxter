/** Per-viewer inventory table column widths, stored in this browser. */
export const INVENTORY_COLUMN_WIDTH_KEY = "baxter.inventory.column-widths";

export const INVENTORY_COLUMN_IDS = [
  "select",
  "photo",
  "vendor",
  "orderNumber",
  "project",
  "category",
  "itemName",
  "description",
  "sku",
  "quantity",
  "unitCostCents",
  "totalCostCents",
  "status",
  "deliveryDate",
  "storage",
  "outDate",
  "notes",
  "link",
] as const;

export type InventoryColumnId = (typeof INVENTORY_COLUMN_IDS)[number];

export type InventoryColumnWidths = Record<InventoryColumnId, number>;

const DEFAULT_WIDTHS: InventoryColumnWidths = {
  select: 40,
  photo: 144,
  vendor: 128,
  orderNumber: 112,
  project: 140,
  category: 112,
  itemName: 200,
  description: 200,
  sku: 112,
  quantity: 72,
  unitCostCents: 96,
  totalCostCents: 96,
  status: 160,
  deliveryDate: 120,
  storage: 148,
  outDate: 112,
  notes: 140,
  link: 64,
};

const MIN_WIDTHS: InventoryColumnWidths = {
  select: 36,
  photo: 72,
  vendor: 72,
  orderNumber: 72,
  project: 72,
  category: 72,
  itemName: 96,
  description: 96,
  sku: 72,
  quantity: 56,
  unitCostCents: 72,
  totalCostCents: 72,
  status: 96,
  deliveryDate: 96,
  storage: 96,
  outDate: 96,
  notes: 72,
  link: 48,
};

const MAX_WIDTH = 640;

const listeners = new Set<() => void>();

let cached: InventoryColumnWidths = DEFAULT_WIDTHS;
let cachedRaw = "";

function clamp(id: InventoryColumnId, width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTHS[id], Math.round(width)));
}

function merge(raw: string): InventoryColumnWidths {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return DEFAULT_WIDTHS;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_WIDTHS;
  const record = parsed as Record<string, unknown>;
  const next = { ...DEFAULT_WIDTHS };
  for (const id of INVENTORY_COLUMN_IDS) {
    const value = record[id];
    if (typeof value === "number" && Number.isFinite(value)) next[id] = clamp(id, value);
  }
  return next;
}

export function subscribeInventoryColumnWidths(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInventoryColumnWidths(): InventoryColumnWidths {
  const raw = window.localStorage.getItem(INVENTORY_COLUMN_WIDTH_KEY) ?? "";
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = raw ? merge(raw) : DEFAULT_WIDTHS;
  return cached;
}

export function getServerInventoryColumnWidths(): InventoryColumnWidths {
  return DEFAULT_WIDTHS;
}

export function inventoryColumnMinWidth(id: InventoryColumnId) {
  return MIN_WIDTHS[id];
}

export function setInventoryColumnWidth(id: InventoryColumnId, width: number) {
  const next = { ...getInventoryColumnWidths(), [id]: clamp(id, width) };
  const raw = JSON.stringify(next);
  window.localStorage.setItem(INVENTORY_COLUMN_WIDTH_KEY, raw);
  cachedRaw = raw;
  cached = next;
  for (const listener of listeners) listener();
}

export function resetInventoryColumnWidths() {
  window.localStorage.removeItem(INVENTORY_COLUMN_WIDTH_KEY);
  cachedRaw = "";
  cached = DEFAULT_WIDTHS;
  for (const listener of listeners) listener();
}
