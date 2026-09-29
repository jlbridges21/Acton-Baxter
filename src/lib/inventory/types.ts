export type InventoryVocabKind = "status" | "storage";

export type InventoryVocabValue = {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
};

export type InventoryItem = {
  id: string;
  orderId: string | null;
  jobId: string | null;
  customProjectLabel: string | null;
  projectLabel: string;
  vendor: string | null;
  orderNumber: string | null;
  category: string | null;
  itemName: string;
  description: string | null;
  sku: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  productUrl: string | null;
  photoUrl: string | null;
  /** Private-bucket path for an imported product photo. Signed into photoUrl for display. */
  photoStoragePath: string | null;
  statusId: string;
  statusLabel: string;
  storageStateId: string | null;
  storageLabel: string | null;
  deliveryDate: string | null;
  outDate: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const INVENTORY_SORT_KEYS = [
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
] as const;

export type InventorySortKey = (typeof INVENTORY_SORT_KEYS)[number];

export type InventoryFilterState = {
  q: string;
  project: string;
  vendor: string;
  orderNumber: string;
  statusId: string;
  storageStateId: string;
  sort: InventorySortKey;
  dir: "asc" | "desc";
  page: number;
};

export const INVENTORY_PAGE_SIZE = 50;

export const DEFAULT_STATUS_LABEL = "Ordered – not in";
