/** Per-viewer product photo size on the inventory table. */
export const INVENTORY_THUMB_STORAGE_KEY = "baxter.inventory.thumb-size";

export const INVENTORY_THUMB_SIZES = ["small", "medium", "large"] as const;

export type InventoryThumbSize = (typeof INVENTORY_THUMB_SIZES)[number];

export function parseInventoryThumbSize(value: string | null): InventoryThumbSize {
  return value === "medium" || value === "large" ? value : "small";
}

const listeners = new Set<() => void>();

export function subscribeInventoryThumbSize(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInventoryThumbSize(): InventoryThumbSize {
  return parseInventoryThumbSize(window.localStorage.getItem(INVENTORY_THUMB_STORAGE_KEY));
}

export function getServerInventoryThumbSize(): InventoryThumbSize {
  return "small";
}

export function setInventoryThumbSize(size: InventoryThumbSize) {
  window.localStorage.setItem(INVENTORY_THUMB_STORAGE_KEY, size);
  for (const listener of listeners) listener();
}

export const INVENTORY_THUMB_CLASS: Record<InventoryThumbSize, string> = {
  small: "h-8 w-10",
  medium: "h-14 w-16",
  large: "h-24 w-28",
};
