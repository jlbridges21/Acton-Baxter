"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  buildInventoryQuery,
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

type TableView = {
  scope: string;
  rows: InventoryItem[];
  total: number;
  matchingIds: string[];
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
  const scope = viewScope(props.filters);
  const [view, setView] = useState<TableView>({
    scope,
    rows: props.rows,
    total: props.total,
    matchingIds: props.matchingIds,
  });
  if (view.scope !== scope) {
    setView({
      scope,
      rows: props.rows,
      total: props.total,
      matchingIds: props.matchingIds,
    });
  }
  const table =
    view.scope === scope
      ? view
      : { scope, rows: props.rows, total: props.total, matchingIds: props.matchingIds };
  const snapshot = useRef<TableView | null>(null);
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

  const query = buildInventoryQuery(props.filters);
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
          <Button type="button" variant="secondary" onClick={() => setImportOpen(true)}>
            Import PDF
          </Button>
          <Button type="button" onClick={() => setEditor("new")}>
            <Plus className="h-4 w-4" aria-hidden />
            Add item
          </Button>
        </div>
      </div>

      <FilterPanel {...props} />

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
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-[var(--acton-border)] bg-white md:block">
        <table className="w-full min-w-[72rem] text-left text-xs">
          <thead className="border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-[var(--acton-navy)]">
            <tr>
              <th className="w-8 px-2 py-1.5">
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
              {INVENTORY_SORT_KEYS.map((key) => (
                <th key={key} className="px-2 py-1.5 font-semibold">
                  <a href={`/inventory${sortHref(props.filters, key)}`} className="hover:underline">
                    {SORT_LABELS[key]}
                    {props.filters.sort === key ? (props.filters.dir === "asc" ? " ↑" : " ↓") : ""}
                  </a>
                </th>
              ))}
              <th className="px-2 py-1.5 font-semibold">Photo</th>
              <th className="px-2 py-1.5 font-semibold">Link</th>
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
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.itemName}`}
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                    />
                  </td>
                  <Cell>{row.vendor}</Cell>
                  <Cell>
                    {row.orderNumber}
                    {row.orderId ? (
                      <a
                        href={`/api/inventory/orders/${row.orderId}/pdf`}
                        className="ml-1 underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        PDF
                      </a>
                    ) : null}
                  </Cell>
                  <Cell>{row.projectLabel}</Cell>
                  <Cell>{row.category}</Cell>
                  <Cell>{row.itemName}</Cell>
                  <Cell>{row.description}</Cell>
                  <Cell>{row.sku}</Cell>
                  <Cell>{row.quantity}</Cell>
                  <Cell>{money(row.unitCostCents)}</Cell>
                  <Cell>{money(row.totalCostCents)}</Cell>
                  <Cell>{row.statusLabel}</Cell>
                  <Cell>{row.deliveryDate}</Cell>
                  <Cell>{row.storageLabel}</Cell>
                  <Cell>{row.outDate}</Cell>
                  <Cell>{row.notes}</Cell>
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                    <PhotoThumb
                      url={row.photoUrl}
                      name={row.itemName}
                      size={thumbSize}
                      onOpen={(url, name) => setPhoto({ url, name })}
                    />
                  </td>
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                    {row.statusLabel}
                    {row.vendor ? ` · ${row.vendor}` : ""}
                    {row.orderNumber ? ` · #${row.orderNumber}` : ""}
                  </p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    Qty {row.quantity} · {money(row.totalCostCents)}
                    {row.storageLabel ? ` · ${row.storageLabel}` : ""}
                  </p>
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      {props.pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span>
            Page {props.page} of {props.pageCount}
          </span>
          <div className="flex gap-2">
            {props.page > 1 ? (
              <a
                className="underline"
                href={`/inventory${buildInventoryQuery(props.filters, { page: props.page - 1 })}`}
              >
                Previous
              </a>
            ) : null}
            {props.page < props.pageCount ? (
              <a
                className="underline"
                href={`/inventory${buildInventoryQuery(props.filters, { page: props.page + 1 })}`}
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
      />
      <ItemDialog
        open={editor !== null}
        item={editor && editor !== "new" ? editor : null}
        statuses={props.statuses}
        storageStates={props.storageStates}
        jobs={props.jobs}
        onClose={() => setEditor(null)}
        onOptimistic={(next) => {
          setView((current) => placeItem(remember(current), next, props.filters));
        }}
        onRollback={() => {
          if (snapshot.current) setView(snapshot.current);
        }}
        onCommitted={(saved, tempId) => {
          setView((current) => replaceItem(current, tempId, saved, props.filters));
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
  return (
    <td className="max-w-[9rem] truncate px-2 py-1 text-[var(--acton-navy)]">{children || "—"}</td>
  );
}

function sortHref(filters: InventoryFilterState, key: InventorySortKey) {
  const dir = filters.sort === key && filters.dir === "asc" ? "desc" : "asc";
  return buildInventoryQuery({ ...filters, sort: key, dir, page: 1 });
}

function FilterPanel(props: Props) {
  return (
    <details open className="rounded-md border border-[var(--acton-border)] bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--acton-navy)]">
        Filters
      </summary>
      <form
        method="get"
        action="/inventory"
        className="grid gap-2 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-3"
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
            defaultValue={props.filters.q}
            placeholder="Item, SKU, or description"
            className="mt-1 h-9"
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
    </details>
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
