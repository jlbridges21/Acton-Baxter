import type { InventoryItem } from "./types";

/**
 * Only keys present on the patch are written.
 * A missing key means "leave the existing value alone."
 * Null on a present optional key clears it.
 */
export type InventoryBulkPatch = {
  statusId?: string;
  storageStateId?: string | null;
  deliveryDate?: string | null;
  outDate?: string | null;
};

export function bulkPatchKeys(patch: InventoryBulkPatch): (keyof InventoryBulkPatch)[] {
  return (Object.keys(patch) as (keyof InventoryBulkPatch)[]).filter(
    (key) => patch[key] !== undefined,
  );
}

export function applyInventoryBulkPatch(
  item: InventoryItem,
  patch: InventoryBulkPatch,
): InventoryItem {
  const next = { ...item };
  if (patch.statusId !== undefined) {
    next.statusId = patch.statusId;
  }
  if (patch.storageStateId !== undefined) {
    next.storageStateId = patch.storageStateId;
  }
  if (patch.deliveryDate !== undefined) {
    next.deliveryDate = patch.deliveryDate;
  }
  if (patch.outDate !== undefined) {
    next.outDate = patch.outDate;
  }
  return next;
}
