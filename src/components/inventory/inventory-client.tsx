"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ExternalLink, Image as ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { InventoryImportDialog } from "@/components/inventory/inventory-import-dialog";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { applyInventoryBulkPatch, type InventoryBulkPatch } from "@/lib/inventory/bulk";
import {
  getInventoryColumnOrder,
  getServerInventoryColumnOrder,
  moveInventoryColumn,
  setInventoryColumnOrder,
  subscribeInventoryColumnOrder,
  type InventoryMovableColumnId,
} from "@/lib/inventory/column-order";
import {
  getInventoryColumnWidths,
  getServerInventoryColumnWidths,
  inventoryColumnMinWidth,
  resetInventoryColumnWidths,
  setInventoryColumnWidth,
  subscribeInventoryColumnWidths,
  type InventoryColumnId,
} from "@/lib/inventory/column-widths";
import {
  buildInventoryQuery,
  countActiveInventoryFilters,
  itemMatchesFilters,
  sortInventoryItems,
} from "@/lib/inventory/filters";
import { parseInventoryUnitCostToCents } from "@/lib/inventory/money";
import {
  getInventoryThumbSize,
  getServerInventoryThumbSize,
  INVENTORY_THUMB_CLASS,
  INVENTORY_THUMB_SIZES,
  setInventoryThumbSize,
  subscribeInventoryThumbSize,
  type InventoryThumbSize,
} from "@/lib/inventory/thumb-size";
import {
  type InventoryFilterState,
  type InventoryItem,
  type InventorySortKey,
  type InventoryVocabValue,
} from "@/lib/inventory/types";
import { formatCentsAsDecimalDollars } from "@/lib/receipts/amount";
import { normalizeCustomJobLabel, shouldOfferCreateCustomJob } from "@/lib/receipts/job-select";

export type InventoryJobOption = { id: string; label: string };

type Props = {
  rows: InventoryItem[];
  matchingIds: string[];
  total: number;
  page: number;
  pageCount: number;
  filters: InventoryFilterState;
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
  jobs: InventoryJobOption[];
  projectOptions: { value: string; label: string }[];
  vendors: string[];
  orderNumbers: string[];
  isAdmin: boolean;
};

const SORT_LABELS: Record<InventorySortKey, string> = {
  vendor: "Vendor",
  orderNumber: "Order #",
  project: "Project",
  category: "Category",
  itemName: "Item",
  description: "Description",
  sku: "SKU",
  quantity: "Qty",
  unitCostCents: "Unit Cost",
  totalCostCents: "Total Cost",
  status: "Status",
  deliveryDate: "Delivery Date",
  storage: "Out of Storage",
  outDate: "Out Date",
  notes: "Notes",
};

function money(cents: number) {
  return `$${formatCentsAsDecimalDollars(cents)}`;
}

function stopRowClick(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function vocabChoices(values: InventoryVocabValue[], currentId: string | null) {
  return [...values]
    .filter((value) => value.isActive || value.id === currentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

function itemWriteBody(row: InventoryItem) {
  return {
    itemName: row.itemName,
    sku: row.sku,
    quantity: row.quantity,
    unitCost: formatCentsAsDecimalDollars(row.unitCostCents),
    statusId: row.statusId,
    jobId: row.jobId,
    customProjectLabel: row.customProjectLabel,
    vendor: row.vendor,
    orderNumber: row.orderNumber,
    category: row.category,
    description: row.description,
    productUrl: row.productUrl,
    photoUrl: row.photoStoragePath ? null : row.photoUrl,
    storageStateId: row.storageStateId,
    deliveryDate: row.deliveryDate,
    outDate: row.outDate,
    notes: row.notes,
  };
}

type TableView = {
  scope: string;
  rows: InventoryItem[];
  total: number;
  matchingIds: string[];
  page: number;
  pageCount: number;
};

function viewScope(filters: InventoryFilterState) {
  return JSON.stringify(filters);
}

function placeItem(
  current: TableView,
  next: InventoryItem,
  filters: InventoryFilterState,
): TableView {
  const visible = itemMatchesFilters(next, filters);
  const had = current.matchingIds.includes(next.id);
  const rest = current.rows.filter((row) => row.id !== next.id);
  return {
    ...current,
    rows: visible ? sortInventoryItems([...rest, next], filters.sort, filters.dir) : rest,
    matchingIds: visible
      ? [...current.matchingIds.filter((id) => id !== next.id), next.id]
      : current.matchingIds.filter((id) => id !== next.id),
    total: current.total + (visible ? 1 : 0) - (had ? 1 : 0),
  };
}

function replaceItem(
  current: TableView,
  tempId: string,
  saved: InventoryItem,
  filters: InventoryFilterState,
): TableView {
  const visible = itemMatchesFilters(saved, filters);
  const had = current.matchingIds.includes(tempId);
  const rest = current.rows.filter((row) => row.id !== tempId && row.id !== saved.id);
  return {
    ...current,
    rows: visible ? sortInventoryItems([...rest, saved], filters.sort, filters.dir) : rest,
    matchingIds: [
      ...current.matchingIds.filter((id) => id !== tempId && id !== saved.id),
      ...(visible ? [saved.id] : []),
    ],
    total: current.total + (visible ? 1 : 0) - (had ? 1 : 0),
  };
}

function todayInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function defaultStatusId(statuses: InventoryVocabValue[]) {
  return (
    statuses.find((status) => status.isDefault)?.id ??
    statuses.find((status) => status.label === "Ordered – not in")?.id ??
    statuses[0]?.id ??
    ""
  );
}

type ItemDraft = {
  itemName: string;
  sku: string;
  quantity: string;
  unitCost: string;
  statusId: string;
  jobId: string;
  customProjectLabel: string;
  vendor: string;
  orderNumber: string;
  category: string;
  description: string;
  productUrl: string;
  photoUrl: string;
  storageStateId: string;
  deliveryDate: string;
  outDate: string;
  notes: string;
};

function emptyDraft(statuses: InventoryVocabValue[]): ItemDraft {
  return {
    itemName: "",
    sku: "",
    quantity: "1",
    unitCost: "",
    statusId: defaultStatusId(statuses),
    jobId: "",
    customProjectLabel: "",
    vendor: "",
    orderNumber: "",
    category: "",
    description: "",
    productUrl: "",
    photoUrl: "",
    storageStateId: "",
    deliveryDate: "",
    outDate: "",
    notes: "",
  };
}

function draftFromItem(item: InventoryItem): ItemDraft {
  return {
    itemName: item.itemName,
    sku: item.sku,
    quantity: String(item.quantity),
    unitCost: formatCentsAsDecimalDollars(item.unitCostCents),
    statusId: item.statusId,
    jobId: item.jobId ?? "",
    customProjectLabel: item.customProjectLabel ?? "",
    vendor: item.vendor ?? "",
    orderNumber: item.orderNumber ?? "",
    category: item.category ?? "",
    description: item.description ?? "",
    productUrl: item.productUrl ?? "",
    photoUrl: item.photoUrl ?? "",
    storageStateId: item.storageStateId ?? "",
    deliveryDate: item.deliveryDate ?? "",
    outDate: item.outDate ?? "",
    notes: item.notes ?? "",
  };
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return payload?.error?.message ?? "Something went wrong";
}

export function InventoryClient(props: Props) {
  const thumbSize = useSyncExternalStore(
    subscribeInventoryThumbSize,
    getInventoryThumbSize,
    getServerInventoryThumbSize,
  );
  const columnWidths = useSyncExternalStore(
    subscribeInventoryColumnWidths,
    getInventoryColumnWidths,
    getServerInventoryColumnWidths,
  );
  const columnOrder = useSyncExternalStore(
    subscribeInventoryColumnOrder,
    getInventoryColumnOrder,
    getServerInventoryColumnOrder,
  );
  const tableFrameRef = useRef<HTMLDivElement>(null);
  const [resizingColumn, setResizingColumn] = useState<InventoryColumnId | null>(null);
  const [resizeGuide, setResizeGuide] = useState<number | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<InventoryMovableColumnId | null>(null);
  const [reorderGuide, setReorderGuide] = useState<number | null>(null);
  const scope = viewScope(props.filters);
  const [searchText, setSearchText] = useState(props.filters.q);
  const [appliedQ, setAppliedQ] = useState(props.filters.q);
  const [view, setView] = useState<TableView>({
    scope,
    rows: props.rows,
    total: props.total,
    matchingIds: props.matchingIds,
    page: props.page,
    pageCount: props.pageCount,
  });
  if (view.scope !== scope) {
    setView({
      scope,
      rows: props.rows,
      total: props.total,
      matchingIds: props.matchingIds,
      page: props.page,
      pageCount: props.pageCount,
    });
    setSearchText(props.filters.q);
    setAppliedQ(props.filters.q);
  }
  const table =
    view.scope === scope
      ? view
      : {
          scope,
          rows: props.rows,
          total: props.total,
          matchingIds: props.matchingIds,
          page: props.page,
          pageCount: props.pageCount,
        };
  const liveFilters = { ...props.filters, q: appliedQ };
  const snapshot = useRef<TableView | null>(null);
  const rowsRef = useRef(table.rows);
  const saveChain = useRef(new Map<string, Promise<void>>());
  const saveGen = useRef(new Map<string, number>());
  const ackedRow = useRef(new Map<string, InventoryItem>());
  const [inlineError, setInlineError] = useState<string | null>(null);
  const searchGen = useRef(0);
  useEffect(() => {
    const q = searchText.trim();
    if (q === appliedQ) return;
    const gen = searchGen.current + 1;
    searchGen.current = gen;
    const filters = props.filters;
    const handle = window.setTimeout(() => {
      void (async () => {
        const next = { ...filters, q, page: 1 };
        const qs = buildInventoryQuery(next);
        window.history.replaceState(null, "", `/inventory${qs}`);
        try {
          const response = await fetch(`/api/inventory${qs}`);
          if (searchGen.current !== gen) return;
          if (!response.ok) {
            setInlineError("Couldn't search inventory. Try again.");
            return;
          }
          const payload = (await response.json()) as {
            rows?: InventoryItem[];
            total?: number;
            matchingIds?: string[];
            page?: number;
            pageCount?: number;
          };
          if (searchGen.current !== gen) return;
          setAppliedQ(q);
          setView((current) => ({
            ...current,
            rows: payload.rows ?? [],
            total: payload.total ?? 0,
            matchingIds: payload.matchingIds ?? [],
            page: payload.page ?? 1,
            pageCount: payload.pageCount ?? 1,
          }));
          setInlineError((current) => (current?.startsWith("Couldn't search") ? null : current));
        } catch {
          if (searchGen.current !== gen) return;
          setInlineError("Couldn't search inventory. Try again.");
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchText, appliedQ, props.filters]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedScope, setSelectedScope] = useState(scope);
  if (selectedScope !== scope) {
    setSelectedScope(scope);
    setSelected(new Set());
  }
  const [editor, setEditor] = useState<InventoryItem | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const visibleIds = table.rows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));
  const selectedCount = selected.size;
  const canSelectRest = table.matchingIds.some((id) => !selected.has(id));
  const singleSelected = table.rows.find((row) => selected.has(row.id));
  const deleteTitle =
    selectedCount === 1 && singleSelected
      ? `Delete ${singleSelected.itemName}?`
      : `Delete ${selectedCount} item${selectedCount === 1 ? "" : "s"}?`;

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function remember(current: TableView) {
    snapshot.current = current;
    return current;
  }

  async function confirmDelete() {
    const ids = [...selected];
    setDeleteError(null);
    setDeleteBusy(true);
    let previous: TableView | null = null;
    setView((current) => {
      previous = current;
      const removed = current.matchingIds.filter((id) => selected.has(id)).length;
      return {
        ...current,
        rows: current.rows.filter((row) => !selected.has(row.id)),
        matchingIds: current.matchingIds.filter((id) => !selected.has(id)),
        total: Math.max(0, current.total - removed),
      };
    });
    try {
      const response = await fetch("/api/inventory/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        if (previous) setView(previous);
        setDeleteError(await readError(response));
        return;
      }
      setSelected(new Set());
      setDeleteOpen(false);
    } catch {
      if (previous) setView(previous);
      setDeleteError("Could not delete those items");
    } finally {
      setDeleteBusy(false);
    }
  }

  function restoreInline(rowId: string) {
    const baseline = ackedRow.current.get(rowId);
    if (!baseline) return;
    setView((current) => {
      const next = placeItem(current, baseline, liveFilters);
      rowsRef.current = next.rows;
      return next;
    });
  }

  function changeInline(rowId: string, patch: (current: InventoryItem) => InventoryItem) {
    setView((current) => {
      const existing = current.rows.find((item) => item.id === rowId);
      if (!existing) return current;
      if (!ackedRow.current.has(rowId)) ackedRow.current.set(rowId, existing);
      const next = placeItem(current, patch(existing), liveFilters);
      rowsRef.current = next.rows;
      return next;
    });
    const gen = (saveGen.current.get(rowId) ?? 0) + 1;
    saveGen.current.set(rowId, gen);
    const previous = saveChain.current.get(rowId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        if (saveGen.current.get(rowId) !== gen) return;
        const latest = rowsRef.current.find((item) => item.id === rowId);
        if (!latest) return;
        let response: Response;
        try {
          response = await fetch(`/api/inventory/${rowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(itemWriteBody(latest)),
          });
        } catch {
          if (saveGen.current.get(rowId) !== gen) return;
          restoreInline(rowId);
          setInlineError(`Couldn't update ${latest.itemName}. Check the connection and try again.`);
          return;
        }
        if (saveGen.current.get(rowId) !== gen) return;
        if (!response.ok) {
          restoreInline(rowId);
          setInlineError(`Couldn't update ${latest.itemName}. ${await readError(response)}`);
          return;
        }
        ackedRow.current.set(rowId, latest);
        setInlineError((current) => (current?.includes(latest.itemName) ? null : current));
      });
    saveChain.current.set(rowId, run);
  }

  function renderDataCell(row: InventoryItem, key: InventorySortKey) {
    if (key === "status") {
      return (
        <td key={key} className="px-2 py-1" onClick={stopRowClick} onMouseDown={stopRowClick}>
          <InlineVocabSelect
            label={`Status for ${row.itemName}`}
            value={row.statusId}
            options={vocabChoices(props.statuses, row.statusId)}
            onChange={(statusId) => {
              const status = props.statuses.find((value) => value.id === statusId);
              if (!status) return;
              changeInline(row.id, (current) => ({
                ...current,
                statusId,
                statusLabel: status.label,
              }));
            }}
          />
        </td>
      );
    }
    if (key === "storage") {
      return (
        <td key={key} className="px-2 py-1" onClick={stopRowClick} onMouseDown={stopRowClick}>
          <InlineVocabSelect
            label={`Out of storage for ${row.itemName}`}
            value={row.storageStateId ?? ""}
            options={vocabChoices(props.storageStates, row.storageStateId)}
            allowEmpty
            emptyLabel="Not set"
            onChange={(storageStateId) => {
              const storage = props.storageStates.find((value) => value.id === storageStateId);
              changeInline(row.id, (current) => ({
                ...current,
                storageStateId: storageStateId || null,
                storageLabel: storage?.label ?? null,
              }));
            }}
          />
        </td>
      );
    }
    if (key === "deliveryDate" || key === "outDate") {
      const label = key === "deliveryDate" ? "Delivery date" : "Out date";
      return (
        <td key={key} className="px-2 py-1" onClick={stopRowClick} onMouseDown={stopRowClick}>
          <InlineDateEditor
            label={`${label} for ${row.itemName}`}
            value={row[key]}
            onCommit={(next) => {
              changeInline(row.id, (current) => ({ ...current, [key]: next }));
            }}
          />
        </td>
      );
    }
    if (key === "orderNumber") {
      return (
        <Cell key={key}>
          {row.orderNumber}
          {row.orderId ? (
            <a
              href={`/api/inventory/orders/${row.orderId}/pdf`}
              className="ml-1 underline"
              onClick={stopRowClick}
            >
              PDF
            </a>
          ) : null}
        </Cell>
      );
    }
    const text: Record<InventorySortKey, ReactNode> = {
      vendor: row.vendor,
      orderNumber: row.orderNumber,
      project: row.projectLabel,
      category: row.category,
      itemName: row.itemName,
      description: row.description,
      sku: row.sku,
      quantity: row.quantity,
      unitCostCents: money(row.unitCostCents),
      totalCostCents: money(row.totalCostCents),
      status: row.statusLabel,
      deliveryDate: row.deliveryDate,
      storage: row.storageLabel,
      outDate: row.outDate,
      notes: row.notes,
    };
    return <Cell key={key}>{text[key]}</Cell>;
  }

  function frameX(clientX: number) {
    const frame = tableFrameRef.current;
    if (!frame) return clientX;
    return clientX - frame.getBoundingClientRect().left;
  }

  function dropIndexFor(clientX: number) {
    const frame = tableFrameRef.current;
    if (!frame) return columnOrder.length;
    const nodes = [...frame.querySelectorAll<HTMLElement>("[data-column-id]")];
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX < rect.left + rect.width / 2) return index;
    }
    return nodes.length;
  }

  function beginResize(id: InventoryColumnId, startX: number) {
    const startWidth = columnWidths[id];
    const min = inventoryColumnMinWidth(id);
    setResizingColumn(id);
    setResizeGuide(frameX(startX));
    function move(event: PointerEvent) {
      setInventoryColumnWidth(id, Math.max(min, startWidth + event.clientX - startX));
      setResizeGuide(frameX(event.clientX));
    }
    function end() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setResizingColumn(null);
      setResizeGuide(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function previewReorder(id: InventoryMovableColumnId, clientX: number) {
    setDraggingColumn(id);
    const frame = tableFrameRef.current;
    const nodes = frame ? [...frame.querySelectorAll<HTMLElement>("[data-column-id]")] : [];
    const index = dropIndexFor(clientX);
    const edge =
      index >= nodes.length
        ? nodes[nodes.length - 1]?.getBoundingClientRect().right
        : nodes[index]?.getBoundingClientRect().left;
    setReorderGuide(edge == null ? frameX(clientX) : frameX(edge));
  }

  function finishReorder(id: InventoryMovableColumnId, clientX: number) {
    const next = moveInventoryColumn(getInventoryColumnOrder(), id, dropIndexFor(clientX));
    setInventoryColumnOrder(next);
    setDraggingColumn(null);
    setReorderGuide(null);
  }

  function cancelReorder() {
    setDraggingColumn(null);
    setReorderGuide(null);
  }

  const query = buildInventoryQuery(liveFilters);
  const exportHref = `/inventory/export${query}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">Inventory</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            {table.total} item{table.total === 1 ? "" : "s"}
            {selectedCount ? ` · ${selectedCount} selected` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.isAdmin ? (
            <a
              href="/admin/inventory-settings"
              className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-semibold text-[var(--acton-navy)]"
            >
              Statuses
            </a>
          ) : null}
          <a
            href={exportHref}
            className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm font-semibold text-[var(--acton-navy)]"
          >
            Export CSV
          </a>
          <Button type="button" onClick={() => setImportOpen(true)}>
            Import PDF
          </Button>
          <Button type="button" onClick={() => setEditor("new")}>
            <Plus className="h-4 w-4" aria-hidden />
            Add item
          </Button>
        </div>
      </div>

      <FilterPanel
        {...props}
        filters={liveFilters}
        searchText={searchText}
        onSearchText={setSearchText}
      />
      {inlineError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {inlineError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm">
        {selectedCount > 0 ? (
          <>
            <span className="font-semibold text-[var(--acton-navy)]">{selectedCount} selected</span>
            {canSelectRest ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSelected(new Set(table.matchingIds))}
              >
                Select all {table.total} matching
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              aria-label="Edit selected"
              onClick={() => setBulkOpen(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-label="Delete selected"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </>
        ) : (
          <span className="text-[var(--acton-muted)]">Select items to edit or delete</span>
        )}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Thumbnail size">
          {INVENTORY_THUMB_SIZES.map((size) => (
            <Button
              key={size}
              type="button"
              size="sm"
              variant={thumbSize === size ? "secondary" : "ghost"}
              aria-label={`${size.charAt(0).toUpperCase()}${size.slice(1)} thumbnails`}
              aria-pressed={thumbSize === size}
              onClick={() => setInventoryThumbSize(size)}
            >
              <ImageIcon
                className={size === "small" ? "h-3 w-3" : size === "medium" ? "h-4 w-4" : "h-5 w-5"}
                aria-hidden
              />
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => resetInventoryColumnWidths()}
          >
            Reset columns
          </Button>
        </div>
      </div>

      <div className="relative hidden overflow-x-auto rounded-md border border-[var(--acton-border)] bg-white md:block">
        <div ref={tableFrameRef} className="relative">
          <table
            className="table-fixed text-left text-xs"
            style={{
              width:
                columnWidths.select + columnOrder.reduce((sum, id) => sum + columnWidths[id], 0),
            }}
          >
            <colgroup>
              <col style={{ width: columnWidths.select }} />
              {columnOrder.map((id) => (
                <col key={id} style={{ width: columnWidths[id] }} />
              ))}
            </colgroup>
            <thead className="border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-[var(--acton-navy)]">
              <tr>
                <th className="px-2 py-1.5" style={{ width: columnWidths.select }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleVisible}
                  />
                </th>
                {columnOrder.map((id) =>
                  id === "photo" || id === "link" ? (
                    <ColumnHeader
                      key={id}
                      columnId={id}
                      label={id === "photo" ? "Photo" : "Link"}
                      width={columnWidths[id]}
                      resizing={resizingColumn === id}
                      dragging={draggingColumn === id}
                      onResizeStart={(startX) => beginResize(id, startX)}
                      onReorderMove={(clientX) => previewReorder(id, clientX)}
                      onReorderEnd={(clientX) => finishReorder(id, clientX)}
                      onReorderCancel={cancelReorder}
                    />
                  ) : (
                    <ColumnHeader
                      key={id}
                      columnId={id}
                      label={SORT_LABELS[id]}
                      sortMark={
                        liveFilters.sort === id ? (liveFilters.dir === "asc" ? " ↑" : " ↓") : ""
                      }
                      width={columnWidths[id]}
                      href={`/inventory${sortHref(liveFilters, id)}`}
                      resizing={resizingColumn === id}
                      dragging={draggingColumn === id}
                      onResizeStart={(startX) => beginResize(id, startX)}
                      onReorderMove={(clientX) => previewReorder(id, clientX)}
                      onReorderEnd={(clientX) => finishReorder(id, clientX)}
                      onReorderCancel={cancelReorder}
                    />
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {table.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={18}
                    className="px-3 py-8 text-center text-sm text-[var(--acton-muted)]"
                  >
                    No items match these filters.
                  </td>
                </tr>
              ) : (
                table.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-[var(--acton-border)] hover:bg-[var(--acton-gray-50)]"
                    onClick={() => setEditor(row)}
                  >
                    <td className="px-2 py-1" onClick={stopRowClick}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.itemName}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                      />
                    </td>
                    {columnOrder.map((id) =>
                      id === "photo" ? (
                        <td
                          key={id}
                          className="w-36 overflow-hidden px-2 py-1 align-middle"
                          data-testid="inventory-photo"
                          onClick={stopRowClick}
                        >
                          <PhotoThumb
                            url={row.photoUrl}
                            name={row.itemName}
                            size={thumbSize}
                            onOpen={(url, name) => setPhoto({ url, name })}
                          />
                        </td>
                      ) : id === "link" ? (
                        <td
                          key={id}
                          className="px-2 py-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.productUrl ? (
                            <a
                              href={row.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open link for ${row.itemName}`}
                              className="text-[var(--acton-navy)]"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </td>
                      ) : (
                        renderDataCell(row, id)
                      ),
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {resizeGuide != null ? (
            <div
              data-testid="column-resize-guide"
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-[var(--acton-navy)]"
              style={{ left: resizeGuide }}
            />
          ) : null}
          {reorderGuide != null ? (
            <div
              data-testid="column-reorder-guide"
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-[var(--acton-navy)]"
              style={{ left: reorderGuide }}
            />
          ) : null}
        </div>
      </div>

      <ul className="space-y-2 md:hidden" data-testid="inventory-cards">
        {table.rows.length === 0 ? (
          <li className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-6 text-center text-sm text-[var(--acton-muted)]">
            No items match these filters.
          </li>
        ) : (
          table.rows.map((row) => (
            <li
              key={row.id}
              className="overflow-hidden rounded-md border border-[var(--acton-border)] bg-white"
            >
              <div className="flex items-start gap-2 p-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${row.itemName}`}
                  className="mt-1 shrink-0"
                  checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id)}
                />
                <PhotoThumb
                  url={row.photoUrl}
                  name={row.itemName}
                  size={thumbSize}
                  onOpen={(url, name) => setPhoto({ url, name })}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditor(row)}
                >
                  <p className="truncate text-sm font-semibold text-[var(--acton-navy)]">
                    {row.itemName}
                  </p>
                  <p className="truncate text-xs text-[var(--acton-muted)]">
                    {row.projectLabel} · {row.sku}
                  </p>
                  <p className="mt-1 text-xs">
                    {row.vendor ? row.vendor : ""}
                    {row.orderNumber ? ` · #${row.orderNumber}` : ""}
                  </p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    Qty {row.quantity} · {money(row.totalCostCents)}
                  </p>
                </button>
              </div>
              <div className="grid gap-2 px-3 pb-3" onClick={stopRowClick}>
                <InlineVocabSelect
                  label={`Status for ${row.itemName}`}
                  value={row.statusId}
                  options={vocabChoices(props.statuses, row.statusId)}
                  onChange={(statusId) => {
                    const status = props.statuses.find((value) => value.id === statusId);
                    if (!status) return;
                    changeInline(row.id, (current) => ({
                      ...current,
                      statusId,
                      statusLabel: status.label,
                    }));
                  }}
                />
                <InlineVocabSelect
                  label={`Out of storage for ${row.itemName}`}
                  value={row.storageStateId ?? ""}
                  options={vocabChoices(props.storageStates, row.storageStateId)}
                  allowEmpty
                  emptyLabel="Not set"
                  onChange={(storageStateId) => {
                    const storage = props.storageStates.find(
                      (value) => value.id === storageStateId,
                    );
                    changeInline(row.id, (current) => ({
                      ...current,
                      storageStateId: storageStateId || null,
                      storageLabel: storage?.label ?? null,
                    }));
                  }}
                />
                <InlineDateEditor
                  label={`Delivery date for ${row.itemName}`}
                  value={row.deliveryDate}
                  onCommit={(next) => {
                    changeInline(row.id, (current) => ({ ...current, deliveryDate: next }));
                  }}
                />
                <InlineDateEditor
                  label={`Out date for ${row.itemName}`}
                  value={row.outDate}
                  onCommit={(next) => {
                    changeInline(row.id, (current) => ({ ...current, outDate: next }));
                  }}
                />
              </div>
            </li>
          ))
        )}
      </ul>

      {table.pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span>
            Page {table.page} of {table.pageCount}
          </span>
          <div className="flex gap-2">
            {table.page > 1 ? (
              <a
                className="underline"
                href={`/inventory${buildInventoryQuery(liveFilters, { page: table.page - 1 })}`}
              >
                Previous
              </a>
            ) : null}
            {table.page < table.pageCount ? (
              <a
                className="underline"
                href={`/inventory${buildInventoryQuery(liveFilters, { page: table.page + 1 })}`}
              >
                Next
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <InventoryImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        jobs={props.jobs}
        statuses={props.statuses}
        onOptimistic={(items) => {
          snapshot.current = table;
          setView((current) =>
            items.reduce((next, item) => placeItem(next, item, liveFilters), current),
          );
        }}
        onRollback={() => {
          if (snapshot.current) setView(snapshot.current);
        }}
        onCommitted={(saved, tempIds) => {
          setView((current) =>
            tempIds.reduce((next, tempId, index) => {
              const item = saved[index];
              return item ? replaceItem(next, tempId, item, liveFilters) : next;
            }, current),
          );
        }}
      />
      <ItemDialog
        open={editor !== null}
        item={editor && editor !== "new" ? editor : null}
        statuses={props.statuses}
        storageStates={props.storageStates}
        jobs={props.jobs}
        onClose={() => setEditor(null)}
        onOptimistic={(next) => {
          setView((current) => placeItem(remember(current), next, liveFilters));
        }}
        onRollback={() => {
          if (snapshot.current) setView(snapshot.current);
        }}
        onCommitted={(saved, tempId) => {
          setView((current) => replaceItem(current, tempId, saved, liveFilters));
          setEditor(null);
        }}
      />
      <BulkDialog
        open={bulkOpen}
        ids={[...selected]}
        statuses={props.statuses}
        storageStates={props.storageStates}
        onClose={() => setBulkOpen(false)}
        onPreview={(patch) => {
          setView((current) => {
            snapshot.current = current;
            return {
              ...current,
              rows: current.rows.map((row) =>
                selected.has(row.id)
                  ? labeledBulk(row, patch, props.statuses, props.storageStates)
                  : row,
              ),
            };
          });
        }}
        onRollback={() => {
          if (snapshot.current) setView(snapshot.current);
        }}
        onSaved={() => {
          setBulkOpen(false);
          setSelected(new Set());
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        onConfirm={() => void confirmDelete()}
        title={deleteTitle}
        description={
          deleteError ??
          "This removes the selection from the inventory list. An imported order and its PDF stay on file."
        }
        confirmLabel={selectedCount === 1 ? "Delete item" : "Delete items"}
        destructive
        busy={deleteBusy}
      />
      <Dialog open={photo !== null} onClose={() => setPhoto(null)} size="lg">
        <DialogHeader>
          <DialogTitle>{photo?.name ?? "Photo"}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={photo.name} className="max-h-[70vh] w-full object-contain" />
          ) : null}
        </DialogBody>
      </Dialog>
    </div>
  );
}

function labeledBulk(
  row: InventoryItem,
  patch: InventoryBulkPatch,
  statuses: InventoryVocabValue[],
  storageStates: InventoryVocabValue[],
): InventoryItem {
  const next = applyInventoryBulkPatch(row, patch);
  const status = statuses.find((value) => value.id === next.statusId);
  const storage = storageStates.find((value) => value.id === next.storageStateId);
  return {
    ...next,
    statusLabel: status?.label ?? next.statusLabel,
    storageLabel: next.storageStateId ? (storage?.label ?? next.storageLabel) : null,
  };
}

function PhotoThumb({
  url,
  name,
  size,
  onOpen,
}: {
  url: string | null;
  name: string;
  size: InventoryThumbSize;
  onOpen: (url: string, name: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const box = `${INVENTORY_THUMB_CLASS[size]} shrink-0 overflow-hidden rounded`;
  if (!url || failed) {
    return (
      <div
        className={`${box} flex items-center justify-center border border-dashed border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-0.5 text-center text-[10px] leading-tight text-[var(--acton-muted)]`}
        aria-label={`No photo for ${name}`}
      >
        No photo
      </div>
    );
  }
  return (
    <button type="button" aria-label={`View photo of ${name}`} onClick={() => onOpen(url, name)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className={`${box} object-cover`} onError={() => setFailed(true)} />
    </button>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="max-w-0 truncate px-2 py-1 text-[var(--acton-navy)]">{children || "—"}</td>;
}

function sortHref(filters: InventoryFilterState, key: InventorySortKey) {
  const dir = filters.sort === key && filters.dir === "asc" ? "desc" : "asc";
  return buildInventoryQuery({ ...filters, sort: key, dir, page: 1 });
}

function FilterPanel(props: Props & { searchText: string; onSearchText: (value: string) => void }) {
  const activeCount = countActiveInventoryFilters(props.filters);
  const scope = viewScope(props.filters);
  const [open, setOpen] = useState(activeCount > 0);
  const [seenScope, setSeenScope] = useState(scope);
  if (seenScope !== scope) {
    setSeenScope(scope);
    setOpen(activeCount > 0);
  }

  return (
    <div>
      <div className={`flex items-center justify-end gap-2 ${open ? "px-3 pt-2" : ""}`}>
        {activeCount > 0 ? (
          <span className="rounded-full bg-[var(--acton-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--acton-navy)]">
            {activeCount} {activeCount === 1 ? "filter" : "filters"} active
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide filters" : "Filters"}
        </Button>
      </div>
      {open ? (
        <form
          method="get"
          action="/inventory"
          className="mt-2 grid gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {props.filters.sort !== "itemName" ? (
            <input type="hidden" name="sort" value={props.filters.sort} />
          ) : null}
          {props.filters.dir !== "asc" ? (
            <input type="hidden" name="dir" value={props.filters.dir} />
          ) : null}
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Search
            <Input
              name="q"
              value={props.searchText}
              placeholder="Search by item, vendor, order #, category, description…"
              className="mt-1 h-9"
              onChange={(event) => props.onSearchText(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Project
            <select
              name="project"
              defaultValue={props.filters.project}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
            >
              <option value="">All projects</option>
              {props.projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Vendor
            <select
              name="vendor"
              defaultValue={props.filters.vendor}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
            >
              <option value="">All vendors</option>
              {props.vendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Order #
            <select
              name="order"
              defaultValue={props.filters.orderNumber}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
            >
              <option value="">All orders</option>
              {props.orderNumbers.map((order) => (
                <option key={order} value={order}>
                  {order}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Status
            <select
              name="status"
              defaultValue={props.filters.statusId}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
            >
              <option value="">All statuses</option>
              {props.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Out of storage
            <select
              name="storage"
              defaultValue={props.filters.storageStateId}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
            >
              <option value="">Any</option>
              {props.storageStates.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
            <a href="/inventory" className="text-sm underline">
              Clear
            </a>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ColumnHeader({
  columnId,
  label,
  sortMark = "",
  width,
  href,
  resizing,
  dragging,
  onResizeStart,
  onReorderMove,
  onReorderEnd,
  onReorderCancel,
}: {
  columnId: InventoryMovableColumnId;
  label: string;
  sortMark?: string;
  width: number;
  href?: string;
  resizing: boolean;
  dragging: boolean;
  onResizeStart: (startX: number) => void;
  onReorderMove: (clientX: number) => void;
  onReorderEnd: (clientX: number) => void;
  onReorderCancel: () => void;
}) {
  const reorderMoved = useRef(false);
  function trackReorder(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest("[data-column-resize]")) return;
    const startX = event.clientX;
    reorderMoved.current = false;
    function move(pointer: PointerEvent) {
      if (!reorderMoved.current && Math.abs(pointer.clientX - startX) < 6) return;
      reorderMoved.current = true;
      onReorderMove(pointer.clientX);
    }
    function end(pointer: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (reorderMoved.current) onReorderEnd(pointer.clientX);
      else onReorderCancel();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return (
    <th
      data-column-id={columnId}
      className={`relative px-2 py-1.5 font-semibold ${dragging ? "cursor-grabbing opacity-60" : "cursor-grab"}`}
      style={{ width }}
      onPointerDown={trackReorder}
    >
      {href ? (
        <a
          href={href}
          className="block truncate hover:underline"
          onClick={(event) => {
            if (!reorderMoved.current) return;
            event.preventDefault();
            event.stopPropagation();
            reorderMoved.current = false;
          }}
        >
          {label}
          {sortMark}
        </a>
      ) : (
        <span className="block truncate">{label}</span>
      )}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        data-column-resize=""
        className="group absolute top-0 right-0 z-20 flex h-full w-4 translate-x-1/2 cursor-col-resize touch-none items-stretch justify-center"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onResizeStart(event.clientX);
        }}
        onClick={stopRowClick}
      >
        <span
          aria-hidden
          className={`h-full ${
            resizing
              ? "w-0.5 bg-[var(--acton-navy)]"
              : "w-px bg-[#4a5c6e] group-hover:w-0.5 group-hover:bg-[#1a2733]"
          }`}
        />
      </span>
    </th>
  );
}

function InlineDateEditor({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | null;
  onCommit: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  return (
    <div
      className="w-full"
      onClick={stopRowClick}
      onMouseDown={stopRowClick}
      onKeyDown={stopRowClick}
    >
      <button
        type="button"
        className="block w-full text-left text-[var(--acton-navy)] underline-offset-2 hover:underline"
        aria-label={label}
        onClick={() => {
          setDraft(value ?? "");
          setOpen(true);
        }}
      >
        {value ? (
          value
        ) : (
          <span className="block w-full overflow-hidden whitespace-nowrap">{"—".repeat(24)}</span>
        )}
      </button>
      {open ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <input
            type="date"
            aria-label={`${label} value`}
            className="h-8 rounded-md border border-[var(--acton-border)] px-1 text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            className="rounded-md bg-[var(--acton-navy)] px-2 py-1 text-xs font-semibold text-white"
            onClick={() => {
              onCommit(draft || null);
              setOpen(false);
            }}
          >
            Save date
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--acton-navy)] underline"
            onClick={() => {
              onCommit(null);
              setOpen(false);
            }}
          >
            Clear date
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InlineVocabSelect({
  label,
  value,
  options,
  allowEmpty = false,
  emptyLabel = "Not set",
  onChange,
}: {
  label: string;
  value: string;
  options: InventoryVocabValue[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      className="h-8 w-full max-w-full rounded-md border border-[var(--acton-border)] bg-white px-1 text-xs"
      onClick={stopRowClick}
      onMouseDown={stopRowClick}
      onKeyDown={stopRowClick}
      onChange={(event) => {
        stopRowClick(event);
        onChange(event.target.value);
      }}
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ProjectField({
  jobs,
  jobId,
  customProjectLabel,
  onChange,
}: {
  jobs: InventoryJobOption[];
  jobId: string;
  customProjectLabel: string;
  onChange: (next: { jobId: string; customProjectLabel: string }) => void;
}) {
  const [query, setQuery] = useState(
    customProjectLabel || jobs.find((job) => job.id === jobId)?.label || "",
  );
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) => job.label.toLowerCase().includes(needle));
  }, [jobs, query]);
  const canCreate = shouldOfferCreateCustomJob(
    query,
    jobs.map((job) => job.label),
  );

  return (
    <div className="relative">
      <Input
        aria-label="Project"
        required
        value={query}
        placeholder="Search the shared project list"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          onChange({ jobId: "", customProjectLabel: "" });
        }}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-[var(--acton-border)] bg-white text-sm shadow">
          {filtered.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-[var(--acton-gray-50)]"
                onClick={() => {
                  setQuery(job.label);
                  setOpen(false);
                  onChange({ jobId: job.id, customProjectLabel: "" });
                }}
              >
                {job.label}
              </button>
            </li>
          ))}
          {canCreate ? (
            <li>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left font-semibold hover:bg-[var(--acton-gray-50)]"
                onClick={() => {
                  const label = normalizeCustomJobLabel(query);
                  setQuery(label);
                  setOpen(false);
                  onChange({ jobId: "", customProjectLabel: label });
                }}
              >
                + Create &quot;{normalizeCustomJobLabel(query)}&quot;
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function RequiredMark() {
  return (
    <abbr title="required" className="text-red-700 no-underline">
      *
    </abbr>
  );
}

function validateDraft(draft: ItemDraft): string | null {
  if (!draft.itemName.trim()) return "Item name is required";
  if (!draft.sku.trim()) return "SKU is required";
  if (!draft.quantity.trim()) return "Quantity is required";
  const quantity = Number.parseInt(draft.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1) return "Quantity must be at least 1";
  try {
    parseInventoryUnitCostToCents(draft.unitCost);
  } catch (error) {
    return error instanceof Error ? error.message : "Unit cost is required";
  }
  if (!draft.statusId) return "Status is required";
  if (!draft.jobId && !draft.customProjectLabel.trim()) return "Project is required";
  return null;
}

function itemFromDraft(
  draft: ItemDraft,
  id: string,
  existing: InventoryItem | null,
  statuses: InventoryVocabValue[],
  storageStates: InventoryVocabValue[],
  jobs: InventoryJobOption[],
): InventoryItem {
  const quantity = Number.parseInt(draft.quantity, 10);
  const unitCostCents = parseInventoryUnitCostToCents(draft.unitCost);
  const status = statuses.find((value) => value.id === draft.statusId);
  const storage = storageStates.find((value) => value.id === draft.storageStateId);
  const job = jobs.find((value) => value.id === draft.jobId);
  const now = new Date().toISOString();
  return {
    id,
    orderId: existing?.orderId ?? null,
    jobId: draft.jobId || null,
    customProjectLabel: draft.customProjectLabel.trim() || null,
    projectLabel: job?.label || draft.customProjectLabel.trim(),
    vendor: draft.vendor.trim() || null,
    orderNumber: draft.orderNumber.trim() || null,
    category: draft.category.trim() || null,
    itemName: draft.itemName.trim(),
    description: draft.description.trim() || null,
    sku: draft.sku.trim(),
    quantity,
    unitCostCents,
    totalCostCents: quantity * unitCostCents,
    productUrl: draft.productUrl.trim() || null,
    photoUrl: draft.photoUrl.trim() || existing?.photoUrl || null,
    photoStoragePath: existing?.photoStoragePath ?? null,
    statusId: draft.statusId,
    statusLabel: status?.label ?? existing?.statusLabel ?? "",
    storageStateId: draft.storageStateId || null,
    storageLabel: draft.storageStateId ? (storage?.label ?? existing?.storageLabel ?? null) : null,
    deliveryDate: draft.deliveryDate || null,
    outDate: draft.outDate || null,
    notes: draft.notes.trim() || null,
    createdBy: existing?.createdBy ?? null,
    updatedBy: existing?.updatedBy ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function ItemDialog({
  open,
  item,
  statuses,
  storageStates,
  jobs,
  onClose,
  onOptimistic,
  onRollback,
  onCommitted,
}: {
  open: boolean;
  item: InventoryItem | null;
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
  jobs: InventoryJobOption[];
  onClose: () => void;
  onOptimistic: (next: InventoryItem) => void;
  onRollback: () => void;
  onCommitted: (saved: InventoryItem, tempId: string) => void;
}) {
  const draftKey = item?.id ?? "new";

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <ItemDialogForm
        key={`${draftKey}-${open ? "open" : "closed"}`}
        item={item}
        statuses={statuses}
        storageStates={storageStates}
        jobs={jobs}
        initial={item ? draftFromItem(item) : emptyDraft(statuses)}
        onClose={onClose}
        onOptimistic={onOptimistic}
        onRollback={onRollback}
        onCommitted={onCommitted}
      />
    </Dialog>
  );
}

function ItemDialogForm({
  item,
  statuses,
  storageStates,
  jobs,
  initial,
  onClose,
  onOptimistic,
  onRollback,
  onCommitted,
}: {
  item: InventoryItem | null;
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
  jobs: InventoryJobOption[];
  initial: ItemDraft;
  onClose: () => void;
  onOptimistic: (next: InventoryItem) => void;
  onRollback: () => void;
  onCommitted: (saved: InventoryItem, tempId: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const quantity = Number.parseInt(draft.quantity, 10);
  const preview =
    Number.isInteger(quantity) && quantity > 0 && draft.unitCost.trim()
      ? (() => {
          try {
            const cents = Math.round(Number(draft.unitCost.replace(/[$,]/g, "")) * 100);
            if (!Number.isFinite(cents) || cents < 0) return null;
            return money(quantity * cents);
          } catch {
            return null;
          }
        })()
      : null;

  function patch(partial: Partial<ItemDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  async function save() {
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const tempId = item?.id ?? `optimistic-${crypto.randomUUID()}`;
    const optimistic = itemFromDraft(draft, tempId, item, statuses, storageStates, jobs);
    onOptimistic(optimistic);
    setPending(true);
    setError(null);
    try {
      const body = {
        itemName: draft.itemName,
        sku: draft.sku,
        quantity: Number.parseInt(draft.quantity, 10),
        unitCost: draft.unitCost,
        statusId: draft.statusId || undefined,
        jobId: draft.jobId || null,
        customProjectLabel: draft.customProjectLabel || null,
        vendor: draft.vendor || null,
        orderNumber: draft.orderNumber || null,
        category: draft.category || null,
        description: draft.description || null,
        productUrl: draft.productUrl || null,
        photoUrl: draft.photoUrl || null,
        storageStateId: draft.storageStateId || null,
        deliveryDate: draft.deliveryDate || null,
        outDate: draft.outDate || null,
        notes: draft.notes || null,
      };
      const response = await fetch(item ? `/api/inventory/${item.id}` : "/api/inventory", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        onRollback();
        setError(await readError(response));
        return;
      }
      const payload = (await response.json()) as { item?: InventoryItem };
      if (!payload.item) {
        onRollback();
        setError("The server did not return the saved item");
        return;
      }
      onCommitted(payload.item, tempId);
    } catch {
      onRollback();
      setError("Could not save this item");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Edit item" : "Add item"}</DialogTitle>
        <DialogDescription>
          Fields marked with * are required. Total cost is quantity times unit cost.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold sm:col-span-2">
          Item name <RequiredMark />
          <Input
            aria-label="Item name"
            required
            value={draft.itemName}
            onChange={(event) => patch({ itemName: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          SKU <RequiredMark />
          <Input
            aria-label="SKU"
            required
            value={draft.sku}
            onChange={(event) => patch({ sku: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Quantity <RequiredMark />
          <Input
            aria-label="Quantity"
            required
            inputMode="numeric"
            value={draft.quantity}
            onChange={(event) => patch({ quantity: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Unit cost <RequiredMark />
          <Input
            aria-label="Unit cost"
            required
            inputMode="decimal"
            value={draft.unitCost}
            onChange={(event) => patch({ unitCost: event.target.value })}
            placeholder="0.00"
            className="mt-1"
          />
        </label>
        <p className="self-end text-sm text-[var(--acton-navy)]">Total {preview ?? "—"}</p>
        <label className="text-xs font-semibold sm:col-span-2">
          Project <RequiredMark />
          <div className="mt-1">
            <ProjectField
              jobs={jobs}
              jobId={draft.jobId}
              customProjectLabel={draft.customProjectLabel}
              onChange={(next) => patch(next)}
            />
          </div>
        </label>
        <label className="text-xs font-semibold">
          Status <RequiredMark />
          <select
            aria-label="Status"
            required
            value={draft.statusId}
            onChange={(event) => patch({ statusId: event.target.value })}
            className="mt-1 h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
          >
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Vendor
          <Input
            aria-label="Vendor"
            value={draft.vendor}
            onChange={(event) => patch({ vendor: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Order #
          <Input
            aria-label="Order number"
            value={draft.orderNumber}
            onChange={(event) => patch({ orderNumber: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Category
          <Input
            value={draft.category}
            onChange={(event) => patch({ category: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold sm:col-span-2">
          Description
          <Input
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Out of storage
          <select
            aria-label="Out of storage"
            value={draft.storageStateId}
            onChange={(event) => patch({ storageStateId: event.target.value })}
            className="mt-1 h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
          >
            <option value="">Not set</option>
            {storageStates.map((state) => (
              <option key={state.id} value={state.id}>
                {state.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Delivery date
          <Input
            aria-label="Delivery date"
            type="date"
            value={draft.deliveryDate}
            onChange={(event) => patch({ deliveryDate: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Out date
          <Input
            aria-label="Out date"
            type="date"
            value={draft.outDate}
            onChange={(event) => patch({ outDate: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold">
          Link
          <Input
            aria-label="Product link"
            value={draft.productUrl}
            onChange={(event) => patch({ productUrl: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold sm:col-span-2">
          Photo URL
          <Input
            aria-label="Photo URL"
            value={draft.photoUrl}
            onChange={(event) => patch({ photoUrl: event.target.value })}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold sm:col-span-2">
          Notes
          <Input
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            className="mt-1"
          />
        </label>
        {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={pending} onClick={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function BulkDialog({
  open,
  ids,
  statuses,
  storageStates,
  onClose,
  onPreview,
  onRollback,
  onSaved,
}: {
  open: boolean;
  ids: string[];
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
  onClose: () => void;
  onPreview: (patch: InventoryBulkPatch) => void;
  onRollback: () => void;
  onSaved: () => void;
}) {
  const [setStatus, setSetStatus] = useState(false);
  const [setStorage, setSetStorage] = useState(false);
  const [setDelivery, setSetDelivery] = useState(false);
  const [setOut, setSetOut] = useState(false);
  const [statusId, setStatusId] = useState(defaultStatusId(statuses));
  const [storageStateId, setStorageStateId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [outDate, setOutDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function apply() {
    const patch: InventoryBulkPatch = {};
    if (setStatus && statusId) patch.statusId = statusId;
    if (setStorage) patch.storageStateId = storageStateId || null;
    if (setDelivery) patch.deliveryDate = deliveryDate || null;
    if (setOut) patch.outDate = outDate || null;
    if (!Object.keys(patch).length) {
      setError("Check a field to change it. Unchecked fields stay as they are.");
      return;
    }
    onPreview(patch);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, patch }),
      });
      if (!response.ok) {
        onRollback();
        setError(await readError(response));
        return;
      }
      onSaved();
    } catch {
      onRollback();
      setError("Could not update those items");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Edit {ids.length} items</DialogTitle>
        <DialogDescription>
          Only checked fields are saved. Everything else stays as it is on each item.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={setStatus}
            onChange={(event) => setSetStatus(event.target.checked)}
          />
          Set status
          <select
            aria-label="Bulk status"
            value={statusId}
            onChange={(event) => setStatusId(event.target.value)}
            className="h-9 flex-1 rounded-md border border-[var(--acton-border)] px-2"
          >
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={setStorage}
            onChange={(event) => setSetStorage(event.target.checked)}
          />
          Set out of storage
          <select
            aria-label="Bulk out of storage"
            value={storageStateId}
            onChange={(event) => setStorageStateId(event.target.value)}
            className="h-9 flex-1 rounded-md border border-[var(--acton-border)] px-2"
          >
            <option value="">Clear</option>
            {storageStates.map((state) => (
              <option key={state.id} value={state.id}>
                {state.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Set delivery date"
            checked={setDelivery}
            onChange={(event) => setSetDelivery(event.target.checked)}
          />
          Set delivery date
          <Input
            aria-label="Bulk delivery date"
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
            className="h-9"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setSetDelivery(true);
              setDeliveryDate(todayInputValue());
            }}
          >
            Today
          </Button>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Set out date"
            checked={setOut}
            onChange={(event) => setSetOut(event.target.checked)}
          />
          Set out date
          <Input
            aria-label="Bulk out date"
            type="date"
            value={outDate}
            onChange={(event) => setOutDate(event.target.value)}
            className="h-9"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={pending} onClick={() => void apply()}>
          Apply
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
