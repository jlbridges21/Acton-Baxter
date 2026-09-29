import {
  INVENTORY_PAGE_SIZE,
  INVENTORY_SORT_KEYS,
  type InventoryFilterState,
  type InventoryItem,
  type InventorySortKey,
} from "./types";

export function emptyInventoryFilters(): InventoryFilterState {
  return {
    q: "",
    project: "",
    vendor: "",
    orderNumber: "",
    statusId: "",
    storageStateId: "",
    sort: "itemName",
    dir: "asc",
    page: 1,
  };
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parseInventoryFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
): InventoryFilterState {
  const get = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key) ?? "";
    return first(params[key]);
  };
  const sortRaw = get("sort");
  const sort = (INVENTORY_SORT_KEYS as readonly string[]).includes(sortRaw)
    ? (sortRaw as InventorySortKey)
    : "itemName";
  const dir = get("dir") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(get("page") || "1", 10) || 1);
  return {
    q: get("q").trim(),
    project: get("project").trim(),
    vendor: get("vendor").trim(),
    orderNumber: get("order").trim(),
    statusId: get("status").trim(),
    storageStateId: get("storage").trim(),
    sort,
    dir,
    page,
  };
}

export function buildInventoryQuery(
  filters: InventoryFilterState,
  patch?: Partial<InventoryFilterState>,
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.project) params.set("project", next.project);
  if (next.vendor) params.set("vendor", next.vendor);
  if (next.orderNumber) params.set("order", next.orderNumber);
  if (next.statusId) params.set("status", next.statusId);
  if (next.storageStateId) params.set("storage", next.storageStateId);
  if (next.sort !== "itemName") params.set("sort", next.sort);
  if (next.dir !== "asc") params.set("dir", next.dir);
  if (next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function projectKey(item: InventoryItem): string {
  if (item.jobId) return item.jobId;
  if (item.customProjectLabel) return `custom:${item.customProjectLabel}`;
  return "";
}

export function itemMatchesFilters(item: InventoryItem, filters: InventoryFilterState): boolean {
  if (filters.project && projectKey(item) !== filters.project) return false;
  if (filters.vendor && (item.vendor ?? "") !== filters.vendor) return false;
  if (filters.orderNumber && (item.orderNumber ?? "") !== filters.orderNumber) return false;
  if (filters.statusId && item.statusId !== filters.statusId) return false;
  if (filters.storageStateId && (item.storageStateId ?? "") !== filters.storageStateId)
    return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.itemName, item.sku, item.description ?? ""].join("\n").toLowerCase();
  return haystack.includes(q);
}

function sortValue(item: InventoryItem, key: InventorySortKey): string | number {
  switch (key) {
    case "vendor":
      return item.vendor ?? "";
    case "orderNumber":
      return item.orderNumber ?? "";
    case "project":
      return item.projectLabel;
    case "category":
      return item.category ?? "";
    case "itemName":
      return item.itemName;
    case "description":
      return item.description ?? "";
    case "sku":
      return item.sku;
    case "quantity":
      return item.quantity;
    case "unitCostCents":
      return item.unitCostCents;
    case "totalCostCents":
      return item.totalCostCents;
    case "status":
      return item.statusLabel;
    case "deliveryDate":
      return item.deliveryDate ?? "";
    case "storage":
      return item.storageLabel ?? "";
    case "outDate":
      return item.outDate ?? "";
    case "notes":
      return item.notes ?? "";
    default:
      return item.itemName;
  }
}

export function sortInventoryItems(
  items: InventoryItem[],
  sort: InventorySortKey,
  dir: "asc" | "desc",
): InventoryItem[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
    if (cmp === 0) cmp = a.id.localeCompare(b.id);
    return cmp * factor;
  });
}

export function applyInventoryQuery(items: InventoryItem[], filters: InventoryFilterState) {
  const matched = sortInventoryItems(
    items.filter((item) => itemMatchesFilters(item, filters)),
    filters.sort,
    filters.dir,
  );
  const total = matched.length;
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * INVENTORY_PAGE_SIZE;
  return {
    rows: matched.slice(start, start + INVENTORY_PAGE_SIZE),
    total,
    matchingIds: matched.map((item) => item.id),
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    pageCount,
  };
}
