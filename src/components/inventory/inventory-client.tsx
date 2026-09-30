"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  Filter,
  Image as ImageIcon,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
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
  INVENTORY_COLUMN_REORDER_DISTANCE,
  getInventoryColumnOrder,
  getServerInventoryColumnOrder,
  resetInventoryColumnOrder,
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
  applyInventoryQuery,
  buildInventoryQuery,
  countActiveInventoryFilters,
  countActiveInventorySorts,
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
  INVENTORY_SORT_KEYS,
  type InventoryFilterState,
  type InventoryItem,
  type InventorySortKey,
  type InventoryVocabValue,
} from "@/lib/inventory/types";
import { formatCentsAsDecimalDollars } from "@/lib/receipts/amount";
import { normalizeCustomJobLabel, shouldOfferCreateCustomJob } from "@/lib/receipts/job-select";

export type InventoryJobOption = { id: string; label: string };

type Props = {
  /** Every inventory row. Sorting, filtering, and search run in the browser. */
  rows: InventoryItem[];
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

function columnHeaderLabel(id: InventoryMovableColumnId) {
  if (id === "photo") return "Photo";
  if (id === "link") return "Link";
  return SORT_LABELS[id];
}

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

function upsertCatalog(items: InventoryItem[], item: InventoryItem) {
  return [...items.filter((row) => row.id !== item.id), item];
}

function swapCatalog(items: InventoryItem[], tempId: string, saved: InventoryItem) {
  return [...items.filter((row) => row.id !== tempId && row.id !== saved.id), saved];
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
  const [activeColumn, setActiveColumn] = useState<InventoryMovableColumnId | null>(null);
  const [draftOrder, setDraftOrder] = useState<InventoryMovableColumnId[] | null>(null);
  const [selectLocked, setSelectLocked] = useState(false);
  const orderRef = useRef(columnOrder);
  const originRef = useRef<InventoryMovableColumnId[] | null>(null);
  const displayOrder = draftOrder ?? columnOrder;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: INVENTORY_COLUMN_REORDER_DISTANCE },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    if (activeColumn) return;
    orderRef.current = columnOrder;
  }, [activeColumn, columnOrder]);
  useEffect(() => {
    if (!selectLocked) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const blockSelect = (event: Event) => event.preventDefault();
    document.addEventListener("selectstart", blockSelect);
    return () => {
      document.body.style.userSelect = previous;
      document.removeEventListener("selectstart", blockSelect);
    };
  }, [selectLocked]);
  useEffect(() => {
    if (!selectLocked || activeColumn) return;
    function release() {
      setSelectLocked(false);
    }
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, [selectLocked, activeColumn]);
  const serverScope = props.rows.map((row) => `${row.id}:${row.updatedAt}`).join("|");
  const [catalogScope, setCatalogScope] = useState(serverScope);
  const [catalog, setCatalog] = useState(props.rows);
  const [filters, setFilters] = useState(props.filters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionBarHeld, setSelectionBarHeld] = useState(false);
  const [selectionBarOpen, setSelectionBarOpen] = useState(false);
  if (catalogScope !== serverScope) {
    setCatalogScope(serverScope);
    setCatalog(props.rows);
    setFilters(props.filters);
    setSelected(new Set());
  }
  if (selected.size > 0 && !selectionBarHeld) {
    setSelectionBarHeld(true);
  } else if (selected.size === 0 && selectionBarOpen) {
    setSelectionBarOpen(false);
  }
  const table = useMemo(() => applyInventoryQuery(catalog, filters), [catalog, filters]);
  const snapshot = useRef<InventoryItem[] | null>(null);
  const rowsRef = useRef(catalog);
  const saveChain = useRef(new Map<string, Promise<void>>());
  const saveGen = useRef(new Map<string, number>());
  const ackedRow = useRef(new Map<string, InventoryItem>());
  const [inlineError, setInlineError] = useState<string | null>(null);
  useEffect(() => {
    rowsRef.current = catalog;
  }, [catalog]);
  useEffect(() => {
    const next = `/inventory${buildInventoryQuery(filters)}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [filters]);
  useEffect(() => {
    if (selected.size > 0) {
      const frame = window.requestAnimationFrame(() => setSelectionBarOpen(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setSelectionBarHeld(false), 200);
    return () => window.clearTimeout(timer);
  }, [selected]);
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

  function remember(items: InventoryItem[]) {
    snapshot.current = items;
    return items;
  }

  function writeCatalog(updater: (items: InventoryItem[]) => InventoryItem[]) {
    setCatalog((current) => {
      const next = updater(current);
      rowsRef.current = next;
      return next;
    });
  }

  async function confirmDelete() {
    const ids = [...selected];
    setDeleteError(null);
    setDeleteBusy(true);
    let previous: InventoryItem[] | null = null;
    writeCatalog((current) => {
      previous = current;
      return current.filter((row) => !selected.has(row.id));
    });
    try {
      const response = await fetch("/api/inventory/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        if (previous) writeCatalog(() => previous as InventoryItem[]);
        setDeleteError(await readError(response));
        return;
      }
      setSelected(new Set());
      setDeleteOpen(false);
    } catch {
      if (previous) writeCatalog(() => previous as InventoryItem[]);
      setDeleteError("Could not delete those items");
    } finally {
      setDeleteBusy(false);
    }
  }

  function restoreInline(rowId: string) {
    const baseline = ackedRow.current.get(rowId);
    if (!baseline) return;
    writeCatalog((current) => upsertCatalog(current, baseline));
  }

  function changeInline(rowId: string, patch: (current: InventoryItem) => InventoryItem) {
    writeCatalog((current) => {
      const existing = current.find((item) => item.id === rowId);
      if (!existing) return current;
      if (!ackedRow.current.has(rowId)) ackedRow.current.set(rowId, existing);
      return upsertCatalog(current, patch(existing));
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
    if (key === "itemName") {
      return (
        <td key={key} className="max-w-0 px-2 py-1">
          <div className="truncate font-semibold text-[var(--acton-navy)]">{row.itemName}</div>
          {row.description ? (
            <div className="truncate text-[11px] leading-tight text-[var(--acton-muted)]">
              {row.description}
            </div>
          ) : null}
        </td>
      );
    }
    return <Cell key={key}>{text[key]}</Cell>;
  }

  function frameX(clientX: number) {
    const frame = tableFrameRef.current;
    if (!frame) return clientX;
    return clientX - frame.getBoundingClientRect().left;
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

  function onColumnDragStart(event: DragStartEvent) {
    const id = String(event.active.id) as InventoryMovableColumnId;
    originRef.current = [...getInventoryColumnOrder()];
    orderRef.current = originRef.current;
    setDraftOrder(originRef.current);
    setActiveColumn(id);
    setSelectLocked(true);
  }

  function onColumnDragOver(event: DragOverEvent) {
    const overId = event.over ? String(event.over.id) : null;
    const activeId = String(event.active.id);
    if (!overId || overId === activeId) return;
    const current = orderRef.current;
    const from = current.indexOf(activeId as InventoryMovableColumnId);
    const to = current.indexOf(overId as InventoryMovableColumnId);
    if (from < 0 || to < 0) return;
    const next = arrayMove(current, from, to);
    orderRef.current = next;
    setDraftOrder(next);
  }

  function onColumnDragEnd(_event: DragEndEvent) {
    setInventoryColumnOrder(orderRef.current);
    originRef.current = null;
    setDraftOrder(null);
    setActiveColumn(null);
    setSelectLocked(false);
  }

  function onColumnDragCancel() {
    const origin = originRef.current;
    if (origin) orderRef.current = origin;
    originRef.current = null;
    setDraftOrder(null);
    setActiveColumn(null);
    setSelectLocked(false);
  }

  function toggleSort(key: InventorySortKey) {
    setFilters((current) => {
      const dir = current.sort === key && current.dir === "asc" ? "desc" : "asc";
      return { ...current, sort: key, dir };
    });
  }

  const query = buildInventoryQuery(filters);
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

      <InventoryToolbar
        filters={filters}
        statuses={props.statuses}
        storageStates={props.storageStates}
        projectOptions={props.projectOptions}
        vendors={props.vendors}
        orderNumbers={props.orderNumbers}
        thumbSize={thumbSize}
        onFilters={setFilters}
      />
      {inlineError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {inlineError}
        </p>
      ) : null}

      <div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            selectionBarOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            {selectionBarHeld ? (
              <div
                data-testid="inventory-selection-bar"
                className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm"
                inert={selectedCount === 0}
                aria-hidden={selectedCount === 0}
              >
                <span className="font-semibold text-[var(--acton-navy)]">
                  {selectedCount} selected
                </span>
                {canSelectRest ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelected(new Set(table.matchingIds))}
                  >
                    Select all {table.total} matching
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </Button>
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
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`relative hidden overflow-x-auto rounded-md border border-[var(--acton-border)] bg-white md:block ${selectLocked ? "select-none" : ""}`}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onColumnDragStart}
            onDragOver={onColumnDragOver}
            onDragEnd={onColumnDragEnd}
            onDragCancel={onColumnDragCancel}
          >
            <div ref={tableFrameRef} className="relative">
              <table
                className={`table-fixed text-left text-xs ${selectLocked ? "select-none" : ""}`}
                style={{
                  width:
                    columnWidths.select +
                    displayOrder.reduce((sum, id) => sum + columnWidths[id], 0),
                }}
              >
                <colgroup>
                  <col style={{ width: columnWidths.select }} />
                  {displayOrder.map((id) => (
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
                    <SortableContext items={displayOrder} strategy={horizontalListSortingStrategy}>
                      {displayOrder.map((id) => (
                        <ColumnHeader
                          key={id}
                          columnId={id}
                          label={columnHeaderLabel(id)}
                          sortable={id !== "photo" && id !== "link"}
                          sortActive={filters.sort === id}
                          sortDir={filters.dir}
                          width={columnWidths[id]}
                          onSort={
                            id === "photo" || id === "link" ? undefined : () => toggleSort(id)
                          }
                          resizing={resizingColumn === id}
                          dragging={activeColumn === id}
                          onResizeStart={(startX) => beginResize(id, startX)}
                          onSelectionLock={() => setSelectLocked(true)}
                        />
                      ))}
                    </SortableContext>
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
                        {displayOrder.map((id) =>
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
            </div>
            <DragOverlay dropAnimation={null}>
              {activeColumn ? (
                <div
                  data-testid="column-drag-preview"
                  className="pointer-events-none rounded-md border border-[var(--acton-navy)] bg-white/75 shadow-xl"
                  style={{ width: Math.max(columnWidths[activeColumn], 96) }}
                >
                  <div className="truncate bg-[var(--acton-gray-50)] px-2 py-1.5 text-xs font-semibold text-[var(--acton-navy)]">
                    {columnHeaderLabel(activeColumn)}
                  </div>
                  <div className="h-16 bg-[var(--acton-navy)]/10" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
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
                    {row.description ? (
                      <p className="truncate text-xs text-[var(--acton-muted)]">
                        {row.description}
                      </p>
                    ) : null}
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
      </div>

      {table.pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span>
            Page {table.page} of {table.pageCount}
          </span>
          <div className="flex gap-2">
            {table.page > 1 ? (
              <button
                type="button"
                className="underline"
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
              >
                Previous
              </button>
            ) : null}
            {table.page < table.pageCount ? (
              <button
                type="button"
                className="underline"
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
              >
                Next
              </button>
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
          writeCatalog((current) => {
            snapshot.current = current;
            return items.reduce((next, item) => upsertCatalog(next, item), current);
          });
        }}
        onRollback={() => {
          if (snapshot.current) writeCatalog(() => snapshot.current as InventoryItem[]);
        }}
        onCommitted={(saved, tempIds) => {
          writeCatalog((current) =>
            tempIds.reduce((next, tempId, index) => {
              const item = saved[index];
              return item ? swapCatalog(next, tempId, item) : next;
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
          writeCatalog((current) => upsertCatalog(remember(current), next));
        }}
        onRollback={() => {
          if (snapshot.current) writeCatalog(() => snapshot.current as InventoryItem[]);
        }}
        onCommitted={(saved, tempId) => {
          writeCatalog((current) => swapCatalog(current, tempId, saved));
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
          writeCatalog((current) => {
            snapshot.current = current;
            return current.map((row) =>
              selected.has(row.id)
                ? labeledBulk(row, patch, props.statuses, props.storageStates)
                : row,
            );
          });
        }}
        onRollback={() => {
          if (snapshot.current) writeCatalog(() => snapshot.current as InventoryItem[]);
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
  return (
    <td className="max-w-0 truncate px-2 py-1 font-medium text-[var(--acton-navy)]">
      {children || "—"}
    </td>
  );
}

function InventoryToolbar(props: {
  filters: InventoryFilterState;
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
  projectOptions: { value: string; label: string }[];
  vendors: string[];
  orderNumbers: string[];
  thumbSize: InventoryThumbSize;
  onFilters: (updater: (current: InventoryFilterState) => InventoryFilterState) => void;
}) {
  const filterCount = countActiveInventoryFilters(props.filters);
  const sortCount = countActiveInventorySorts(props.filters);
  const [filtersOpen, setFiltersOpen] = useState(filterCount > 0);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    props.onFilters((current) => ({
      ...current,
      project: String(data.get("project") ?? ""),
      vendor: String(data.get("vendor") ?? ""),
      orderNumber: String(data.get("order") ?? ""),
      statusId: String(data.get("status") ?? ""),
      storageStateId: String(data.get("storage") ?? ""),
      page: 1,
    }));
  }

  function clearFilters() {
    props.onFilters((current) => ({
      ...current,
      q: "",
      project: "",
      vendor: "",
      orderNumber: "",
      statusId: "",
      storageStateId: "",
      page: 1,
    }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarPill
          label="Filters"
          count={filterCount}
          open={filtersOpen}
          icon={<Filter className="h-4 w-4" aria-hidden />}
          onClick={() => setFiltersOpen((current) => !current)}
        />
        <ToolbarPill
          label="Sort"
          count={sortCount}
          open={sortOpen}
          icon={<ArrowUpDown className="h-4 w-4" aria-hidden />}
          onClick={() => setSortOpen((current) => !current)}
        />
        <label className="relative min-w-[12rem] flex-1 basis-full sm:basis-auto">
          <span className="sr-only">Search inventory</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]"
            aria-hidden
          />
          <Input
            value={props.filters.q}
            placeholder="Search inventory"
            className="h-9 pl-9"
            onChange={(event) => {
              const q = event.target.value;
              props.onFilters((current) => ({ ...current, q, page: 1 }));
            }}
          />
        </label>
        <button
          type="button"
          aria-expanded={columnsOpen}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--acton-border)] bg-white px-3 text-sm font-semibold text-[var(--acton-navy)]"
          onClick={() => setColumnsOpen((current) => !current)}
        >
          <Settings className="h-4 w-4" aria-hidden />
          Manage columns
        </button>
      </div>
      {filtersOpen ? (
        <form
          key={`${props.filters.project}|${props.filters.vendor}|${props.filters.orderNumber}|${props.filters.statusId}|${props.filters.storageStateId}`}
          onSubmit={applyFilters}
          className="grid gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-3 sm:grid-cols-2 lg:grid-cols-3"
        >
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
            <button type="button" className="text-sm underline" onClick={clearFilters}>
              Clear
            </button>
          </div>
        </form>
      ) : null}
      {sortOpen ? (
        <div className="flex flex-wrap gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-3">
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Column
            <select
              aria-label="Sort column"
              value={props.filters.sort}
              className="mt-1 h-9 w-full min-w-40 rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
              onChange={(event) => {
                const sort = event.target.value as InventorySortKey;
                props.onFilters((current) => ({ ...current, sort }));
              }}
            >
              {INVENTORY_SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--acton-navy)]">
            Direction
            <select
              aria-label="Sort direction"
              value={props.filters.dir}
              className="mt-1 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
              onChange={(event) => {
                const dir = event.target.value === "desc" ? "desc" : "asc";
                props.onFilters((current) => ({ ...current, dir }));
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      ) : null}
      {columnsOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-3">
          <div className="flex items-center gap-1" role="group" aria-label="Thumbnail size">
            {INVENTORY_THUMB_SIZES.map((size) => (
              <Button
                key={size}
                type="button"
                size="sm"
                variant={props.thumbSize === size ? "secondary" : "ghost"}
                aria-label={`${size.charAt(0).toUpperCase()}${size.slice(1)} thumbnails`}
                aria-pressed={props.thumbSize === size}
                onClick={() => setInventoryThumbSize(size)}
              >
                <ImageIcon
                  className={
                    size === "small" ? "h-3 w-3" : size === "medium" ? "h-4 w-4" : "h-5 w-5"
                  }
                  aria-hidden
                />
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              resetInventoryColumnWidths();
              resetInventoryColumnOrder();
            }}
          >
            Reset columns
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarPill({
  label,
  count,
  open,
  icon,
  onClick,
}: {
  label: string;
  count: number;
  open: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  const active = count > 0;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={active ? `${label}, ${count} active` : label}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${
        active
          ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
          : "border-[var(--acton-border)] bg-white text-[var(--acton-navy)]"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
      <span
        aria-hidden
        className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs ${
          active
            ? "bg-white text-[var(--acton-navy)]"
            : "bg-[var(--acton-gray-100)] text-[var(--acton-muted)]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ColumnHeader({
  columnId,
  label,
  sortable,
  sortActive,
  sortDir,
  width,
  resizing,
  dragging,
  onSort,
  onResizeStart,
  onSelectionLock,
}: {
  columnId: InventoryMovableColumnId;
  label: string;
  sortable: boolean;
  sortActive: boolean;
  sortDir: "asc" | "desc";
  width: number;
  resizing: boolean;
  dragging: boolean;
  onSort?: () => void;
  onResizeStart: (startX: number) => void;
  onSelectionLock: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: columnId });
  return (
    <th
      className="relative px-2 py-1.5 font-semibold"
      style={{ width }}
      aria-sort={
        sortable
          ? sortActive
            ? sortDir === "asc"
              ? "ascending"
              : "descending"
            : "none"
          : undefined
      }
    >
      <div className="flex items-stretch">
        <div
          ref={setNodeRef}
          data-column-id={columnId}
          className={`min-w-0 flex-1 cursor-grab ${isDragging || dragging ? "cursor-grabbing opacity-40" : ""}`}
          {...attributes}
          {...listeners}
          onPointerDownCapture={(event) => {
            if ((event.target as HTMLElement).closest("[data-column-resize]")) return;
            onSelectionLock();
          }}
        >
          {sortable ? (
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-1 text-left"
              onClick={() => onSort?.()}
            >
              <span className="truncate">{label}</span>
              <SortGlyph active={sortActive} dir={sortDir} />
            </button>
          ) : (
            <span className="block truncate">{label}</span>
          )}
        </div>
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
                : "w-px bg-[#b3c0cc] group-hover:w-0.5 group-hover:bg-[#1a2733]"
            }`}
          />
        </span>
      </div>
    </th>
  );
}

function SortGlyph({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--acton-muted)]" aria-hidden />;
  }
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Icon
      className="h-3.5 w-3.5 shrink-0 text-[var(--acton-navy)]"
      fill="currentColor"
      aria-hidden
    />
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
