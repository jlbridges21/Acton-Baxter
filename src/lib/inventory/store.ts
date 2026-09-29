import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import { applyInventoryBulkPatch, type InventoryBulkPatch } from "./bulk";
import { applyInventoryQuery } from "./filters";
import { inventoryTotalCents } from "./money";
import {
  DEFAULT_STATUS_LABEL,
  type InventoryFilterState,
  type InventoryItem,
  type InventoryVocabKind,
  type InventoryVocabValue,
} from "./types";

type Memory = {
  statuses: InventoryVocabValue[];
  storage: InventoryVocabValue[];
  items: InventoryItem[];
  jobLabels: Map<string, string>;
};

const globalMemory = globalThis as typeof globalThis & { __baxterInventory?: Memory };

const STATUS_SEED: Array<[string, boolean]> = [
  [DEFAULT_STATUS_LABEL, true],
  ["In office", false],
  ["Returned", false],
  ["Set aside", false],
  ["Out of office", false],
];

const STORAGE_SEED: Array<[string, boolean]> = [
  ["Yes – in storage", true],
  ["No – not in storage", false],
  ["Set aside", false],
  ["Returned", false],
];

function emptyMemory(): Memory {
  return {
    statuses: STATUS_SEED.map(([label, isDefault], sortOrder) => ({
      id: randomUUID(),
      label,
      sortOrder,
      isActive: true,
      isDefault,
    })),
    storage: STORAGE_SEED.map(([label, isDefault], sortOrder) => ({
      id: randomUUID(),
      label,
      sortOrder,
      isActive: true,
      isDefault,
    })),
    items: [],
    jobLabels: new Map(),
  };
}

function memory(): Memory {
  if (!globalMemory.__baxterInventory) globalMemory.__baxterInventory = emptyMemory();
  return globalMemory.__baxterInventory;
}

export function resetInventoryMemoryForTests() {
  globalMemory.__baxterInventory = emptyMemory();
}

export function rememberInventoryJobLabelForTests(jobId: string, label: string) {
  memory().jobLabels.set(jobId, label);
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function vocabList(kind: InventoryVocabKind): InventoryVocabValue[] {
  return kind === "status" ? memory().statuses : memory().storage;
}

function sortVocab(values: InventoryVocabValue[]) {
  return [...values].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export async function listInventoryVocab(kind: InventoryVocabKind): Promise<InventoryVocabValue[]> {
  if (shouldUseMemory()) return sortVocab(vocabList(kind));
  const supabase = createServiceClient();
  const table = kind === "status" ? "inventory_statuses" : "inventory_storage_states";
  const { data, error } = await supabase
    .from(table)
    .select("id, label, sort_order, is_active, is_default")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
    isDefault: row.is_default as boolean,
  }));
}

function defaultValue(values: InventoryVocabValue[]) {
  return values.find((value) => value.isDefault) ?? values.find((value) => value.isActive) ?? null;
}

export type InventoryItemInput = {
  itemName: string;
  sku: string;
  quantity: number;
  unitCostCents: number;
  statusId?: string | null;
  jobId?: string | null;
  customProjectLabel?: string | null;
  vendor?: string | null;
  orderNumber?: string | null;
  category?: string | null;
  description?: string | null;
  productUrl?: string | null;
  photoUrl?: string | null;
  storageStateId?: string | null;
  deliveryDate?: string | null;
  outDate?: string | null;
  notes?: string | null;
  actorId: string;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

async function resolveProject(input: {
  jobId?: string | null;
  customProjectLabel?: string | null;
}): Promise<{ jobId: string | null; customProjectLabel: string | null; projectLabel: string }> {
  const jobId = input.jobId ?? null;
  const custom = clean(input.customProjectLabel);
  if (jobId && custom)
    throw new ValidationError("Choose a project from the list or a custom name, not both");
  if (!jobId && !custom) throw new ValidationError("Project is required");
  if (custom) return { jobId: null, customProjectLabel: custom, projectLabel: custom };
  const label = await lookupJobLabel(jobId!);
  if (!label) throw new ValidationError("That project is not on the shared project list");
  return { jobId, customProjectLabel: null, projectLabel: label };
}

async function lookupJobLabel(jobId: string): Promise<string | null> {
  if (shouldUseMemory()) return memory().jobLabels.get(jobId) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expense_jobs")
    .select("label")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data?.label as string | undefined) ?? null;
}

function assertUrl(value: string | null, label: string): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(`${label} must be a valid http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`${label} must start with http:// or https://`);
  }
  return url.toString();
}

async function requireStatus(statusId: string | null | undefined): Promise<InventoryVocabValue> {
  const statuses = await listInventoryVocab("status");
  if (statusId) {
    const found = statuses.find((status) => status.id === statusId);
    if (!found) throw new ValidationError("Status is not valid");
    return found;
  }
  const fallback =
    statuses.find((status) => status.label === DEFAULT_STATUS_LABEL) ?? defaultValue(statuses);
  if (!fallback) throw new ValidationError("Status is required");
  return fallback;
}

async function optionalStorage(id: string | null | undefined): Promise<InventoryVocabValue | null> {
  if (!id) return null;
  const states = await listInventoryVocab("storage");
  const found = states.find((state) => state.id === id);
  if (!found) throw new ValidationError("Out-of-storage state is not valid");
  return found;
}

function withLabels(
  item: InventoryItem,
  status: InventoryVocabValue,
  storage: InventoryVocabValue | null,
): InventoryItem {
  return {
    ...item,
    statusId: status.id,
    statusLabel: status.label,
    storageStateId: storage?.id ?? null,
    storageLabel: storage?.label ?? null,
    totalCostCents: inventoryTotalCents(item.quantity, item.unitCostCents),
  };
}

export async function createInventoryItem(input: InventoryItemInput): Promise<InventoryItem> {
  const project = await resolveProject(input);
  const status = await requireStatus(input.statusId);
  const storage = await optionalStorage(input.storageStateId);
  const itemName = input.itemName.trim();
  const sku = input.sku.trim();
  if (!itemName) throw new ValidationError("Item name is required");
  if (!sku) throw new ValidationError("SKU is required");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ValidationError("Quantity must be at least 1");
  }
  if (!Number.isInteger(input.unitCostCents) || input.unitCostCents < 0) {
    throw new ValidationError("Unit cost cannot be negative");
  }
  const now = nowIso();
  const row: InventoryItem = withLabels(
    {
      id: randomUUID(),
      orderId: null,
      jobId: project.jobId,
      customProjectLabel: project.customProjectLabel,
      projectLabel: project.projectLabel,
      vendor: clean(input.vendor),
      orderNumber: clean(input.orderNumber),
      category: clean(input.category),
      itemName,
      description: clean(input.description),
      sku,
      quantity: input.quantity,
      unitCostCents: input.unitCostCents,
      totalCostCents: inventoryTotalCents(input.quantity, input.unitCostCents),
      productUrl: assertUrl(clean(input.productUrl), "Link"),
      photoUrl: assertUrl(clean(input.photoUrl), "Photo"),
      statusId: status.id,
      statusLabel: status.label,
      storageStateId: storage?.id ?? null,
      storageLabel: storage?.label ?? null,
      deliveryDate: input.deliveryDate ?? null,
      outDate: input.outDate ?? null,
      notes: clean(input.notes),
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    },
    status,
    storage,
  );

  if (shouldUseMemory()) {
    memory().items.push(row);
    return row;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      id: row.id,
      job_id: row.jobId,
      custom_project_label: row.customProjectLabel,
      vendor: row.vendor,
      order_number: row.orderNumber,
      category: row.category,
      item_name: row.itemName,
      description: row.description,
      sku: row.sku,
      quantity: row.quantity,
      unit_cost_cents: row.unitCostCents,
      product_url: row.productUrl,
      photo_url: row.photoUrl,
      status_id: row.statusId,
      storage_state_id: row.storageStateId,
      delivery_date: row.deliveryDate,
      out_date: row.outDate,
      notes: row.notes,
      created_by: row.createdBy,
      updated_by: row.updatedBy,
    })
    .select("id, total_cost_cents")
    .single();
  if (error) throw error;
  return { ...row, totalCostCents: data.total_cost_cents as number };
}

export async function updateInventoryItem(
  id: string,
  input: InventoryItemInput,
): Promise<InventoryItem> {
  const existing = await getInventoryItem(id);
  const project = await resolveProject(input);
  const status = await requireStatus(input.statusId ?? existing.statusId);
  const storage = await optionalStorage(
    input.storageStateId === undefined ? existing.storageStateId : input.storageStateId,
  );
  const next: InventoryItem = withLabels(
    {
      ...existing,
      jobId: project.jobId,
      customProjectLabel: project.customProjectLabel,
      projectLabel: project.projectLabel,
      vendor: clean(input.vendor),
      orderNumber: clean(input.orderNumber),
      category: clean(input.category),
      itemName: input.itemName.trim(),
      description: clean(input.description),
      sku: input.sku.trim(),
      quantity: input.quantity,
      unitCostCents: input.unitCostCents,
      totalCostCents: inventoryTotalCents(input.quantity, input.unitCostCents),
      productUrl: assertUrl(clean(input.productUrl), "Link"),
      photoUrl: assertUrl(clean(input.photoUrl), "Photo"),
      deliveryDate: input.deliveryDate ?? null,
      outDate: input.outDate ?? null,
      notes: clean(input.notes),
      updatedBy: input.actorId,
      updatedAt: nowIso(),
    },
    status,
    storage,
  );
  if (!next.itemName) throw new ValidationError("Item name is required");
  if (!next.sku) throw new ValidationError("SKU is required");

  if (shouldUseMemory()) {
    memory().items = memory().items.map((item) => (item.id === id ? next : item));
    return next;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inventory_items")
    .update({
      job_id: next.jobId,
      custom_project_label: next.customProjectLabel,
      vendor: next.vendor,
      order_number: next.orderNumber,
      category: next.category,
      item_name: next.itemName,
      description: next.description,
      sku: next.sku,
      quantity: next.quantity,
      unit_cost_cents: next.unitCostCents,
      product_url: next.productUrl,
      photo_url: next.photoUrl,
      status_id: next.statusId,
      storage_state_id: next.storageStateId,
      delivery_date: next.deliveryDate,
      out_date: next.outDate,
      notes: next.notes,
      updated_by: next.updatedBy,
      updated_at: next.updatedAt,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
  return next;
}

export async function getInventoryItem(id: string): Promise<InventoryItem> {
  const items = await listAllInventoryItems();
  const found = items.find((item) => item.id === id);
  if (!found) throw new NotFoundError("Inventory item not found");
  return found;
}

export async function listAllInventoryItems(): Promise<InventoryItem[]> {
  if (shouldUseMemory()) return memory().items.filter((item) => item.id);
  const supabase = createServiceClient();
  const [{ data, error }, statuses, storage, jobs] = await Promise.all([
    supabase.from("inventory_items").select("*").is("deleted_at", null),
    listInventoryVocab("status"),
    listInventoryVocab("storage"),
    supabase.from("expense_jobs").select("id, label"),
  ]);
  if (error) throw error;
  const statusById = new Map(statuses.map((value) => [value.id, value.label]));
  const storageById = new Map(storage.map((value) => [value.id, value.label]));
  const jobById = new Map((jobs.data ?? []).map((job) => [job.id as string, job.label as string]));
  return (data ?? []).map((row) => mapDbItem(row, statusById, storageById, jobById));
}

function mapDbItem(
  row: Record<string, unknown>,
  statusById: Map<string, string>,
  storageById: Map<string, string>,
  jobById: Map<string, string>,
): InventoryItem {
  const jobId = (row.job_id as string | null) ?? null;
  const custom = (row.custom_project_label as string | null) ?? null;
  const statusId = row.status_id as string;
  const storageStateId = (row.storage_state_id as string | null) ?? null;
  const quantity = row.quantity as number;
  const unitCostCents = row.unit_cost_cents as number;
  return {
    id: row.id as string,
    orderId: (row.order_id as string | null) ?? null,
    jobId,
    customProjectLabel: custom,
    projectLabel: jobId ? (jobById.get(jobId) ?? "Project") : (custom ?? ""),
    vendor: (row.vendor as string | null) ?? null,
    orderNumber: (row.order_number as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    itemName: row.item_name as string,
    description: (row.description as string | null) ?? null,
    sku: row.sku as string,
    quantity,
    unitCostCents,
    totalCostCents:
      (row.total_cost_cents as number | null) ?? inventoryTotalCents(quantity, unitCostCents),
    productUrl: (row.product_url as string | null) ?? null,
    photoUrl: (row.photo_url as string | null) ?? null,
    statusId,
    statusLabel: statusById.get(statusId) ?? "Status",
    storageStateId,
    storageLabel: storageStateId ? (storageById.get(storageStateId) ?? null) : null,
    deliveryDate: (row.delivery_date as string | null) ?? null,
    outDate: (row.out_date as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function queryInventory(filters: InventoryFilterState) {
  return applyInventoryQuery(await listAllInventoryItems(), filters);
}

export async function bulkUpdateInventoryItems(input: {
  ids: string[];
  patch: InventoryBulkPatch;
  actorId: string;
}): Promise<number> {
  const keys = Object.entries(input.patch).filter(([, value]) => value !== undefined);
  if (!keys.length) throw new ValidationError("Choose at least one field to update");
  if (input.patch.statusId) await requireStatus(input.patch.statusId);
  if (input.patch.storageStateId) await optionalStorage(input.patch.storageStateId);

  const idSet = new Set(input.ids);
  const items = await listAllInventoryItems();
  const targets = items.filter((item) => idSet.has(item.id));
  if (!targets.length) throw new NotFoundError("No matching inventory items");

  if (shouldUseMemory()) {
    const statuses = await listInventoryVocab("status");
    const storage = await listInventoryVocab("storage");
    memory().items = memory().items.map((item) => {
      if (!idSet.has(item.id)) return item;
      const patched = applyInventoryBulkPatch(item, input.patch);
      const status = statuses.find((value) => value.id === patched.statusId);
      const state = storage.find((value) => value.id === patched.storageStateId);
      return {
        ...patched,
        statusLabel: status?.label ?? patched.statusLabel,
        storageLabel: state?.label ?? (patched.storageStateId ? patched.storageLabel : null),
        updatedBy: input.actorId,
        updatedAt: nowIso(),
      };
    });
    return targets.length;
  }

  const supabase = createServiceClient();
  const dbPatch: Record<string, unknown> = {
    updated_by: input.actorId,
    updated_at: nowIso(),
  };
  if (input.patch.statusId !== undefined) dbPatch.status_id = input.patch.statusId;
  if (input.patch.storageStateId !== undefined)
    dbPatch.storage_state_id = input.patch.storageStateId;
  if (input.patch.deliveryDate !== undefined) dbPatch.delivery_date = input.patch.deliveryDate;
  if (input.patch.outDate !== undefined) dbPatch.out_date = input.patch.outDate;
  const { error } = await supabase
    .from("inventory_items")
    .update(dbPatch)
    .in(
      "id",
      targets.map((item) => item.id),
    );
  if (error) throw error;
  return targets.length;
}

export async function softDeleteInventoryItem(id: string, actorId: string): Promise<void> {
  await getInventoryItem(id);
  if (shouldUseMemory()) {
    memory().items = memory().items.filter((item) => item.id !== id);
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inventory_items")
    .update({ deleted_at: nowIso(), updated_by: actorId, updated_at: nowIso() })
    .eq("id", id);
  if (error) throw error;
}

function referenceCount(kind: InventoryVocabKind, id: string): number {
  return memory().items.filter((item) =>
    kind === "status" ? item.statusId === id : item.storageStateId === id,
  ).length;
}

export async function createInventoryVocab(input: {
  kind: InventoryVocabKind;
  label: string;
  isActive?: boolean;
  isDefault?: boolean;
}): Promise<InventoryVocabValue> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Label is required");
  const values = await listInventoryVocab(input.kind);
  if (values.some((value) => value.label.toLowerCase() === label.toLowerCase())) {
    throw new ValidationError("That label already exists");
  }
  const created: InventoryVocabValue = {
    id: randomUUID(),
    label,
    sortOrder: values.reduce((max, value) => Math.max(max, value.sortOrder), -1) + 1,
    isActive: input.isActive ?? true,
    isDefault: input.isDefault ?? false,
  };
  if (shouldUseMemory()) {
    const list = vocabList(input.kind);
    if (created.isDefault) for (const value of list) value.isDefault = false;
    list.push(created);
    return created;
  }
  const supabase = createServiceClient();
  const table = input.kind === "status" ? "inventory_statuses" : "inventory_storage_states";
  if (created.isDefault) {
    await supabase.from(table).update({ is_default: false }).eq("is_default", true);
  }
  const { error } = await supabase.from(table).insert({
    id: created.id,
    label: created.label,
    sort_order: created.sortOrder,
    is_active: created.isActive,
    is_default: created.isDefault,
  });
  if (error) throw error;
  return created;
}

export async function updateInventoryVocab(
  kind: InventoryVocabKind,
  id: string,
  input: { label?: string; isActive?: boolean; isDefault?: boolean; direction?: "up" | "down" },
): Promise<InventoryVocabValue> {
  const values = sortVocab(await listInventoryVocab(kind));
  const current = values.find((value) => value.id === id);
  if (!current) throw new NotFoundError("Vocabulary value not found");
  if (input.direction) {
    const index = values.findIndex((value) => value.id === id);
    const swapWith = input.direction === "up" ? index - 1 : index + 1;
    const other = values[swapWith];
    if (!other) return current;
    const currentOrder = current.sortOrder;
    current.sortOrder = other.sortOrder;
    other.sortOrder = currentOrder;
    if (!shouldUseMemory()) {
      const supabase = createServiceClient();
      const table = kind === "status" ? "inventory_statuses" : "inventory_storage_states";
      await supabase.from(table).update({ sort_order: current.sortOrder }).eq("id", current.id);
      await supabase.from(table).update({ sort_order: other.sortOrder }).eq("id", other.id);
    }
    return current;
  }
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new ValidationError("Label is required");
    if (
      values.some((value) => value.id !== id && value.label.toLowerCase() === label.toLowerCase())
    ) {
      throw new ValidationError("That label already exists");
    }
    current.label = label;
  }
  if (input.isActive !== undefined) current.isActive = input.isActive;
  if (input.isDefault) {
    for (const value of values) value.isDefault = value.id === id;
    current.isDefault = true;
  }
  if (!shouldUseMemory()) {
    const supabase = createServiceClient();
    const table = kind === "status" ? "inventory_statuses" : "inventory_storage_states";
    if (input.isDefault) {
      await supabase.from(table).update({ is_default: false }).neq("id", id);
    }
    const { error } = await supabase
      .from(table)
      .update({
        label: current.label,
        is_active: current.isActive,
        is_default: current.isDefault,
        sort_order: current.sortOrder,
      })
      .eq("id", id);
    if (error) throw error;
  } else if (kind === "status") {
    for (const item of memory().items) {
      if (item.statusId === id) item.statusLabel = current.label;
    }
  } else {
    for (const item of memory().items) {
      if (item.storageStateId === id) item.storageLabel = current.label;
    }
  }
  return current;
}

export async function deleteInventoryVocab(
  kind: InventoryVocabKind,
  id: string,
  reassignToId?: string,
): Promise<{ reassigned: number }> {
  const values = await listInventoryVocab(kind);
  const current = values.find((value) => value.id === id);
  if (!current) throw new NotFoundError("Vocabulary value not found");
  if (values.length <= 1) {
    throw new ValidationError("Keep at least one value in this list");
  }
  const count = shouldUseMemory() ? referenceCount(kind, id) : await countVocabReferences(kind, id);
  if (count > 0 && !reassignToId) {
    throw new ValidationError(
      `${count} item${count === 1 ? "" : "s"} still use “${current.label}”. Pick a replacement to delete it.`,
    );
  }
  if (reassignToId) {
    if (reassignToId === id) throw new ValidationError("Pick a different replacement");
    const target = values.find((value) => value.id === reassignToId);
    if (!target) throw new ValidationError("Replacement value was not found");
  }

  if (shouldUseMemory()) {
    if (reassignToId) {
      const target = values.find((value) => value.id === reassignToId)!;
      for (const item of memory().items) {
        if (kind === "status" && item.statusId === id) {
          item.statusId = target.id;
          item.statusLabel = target.label;
        }
        if (kind === "storage" && item.storageStateId === id) {
          item.storageStateId = target.id;
          item.storageLabel = target.label;
        }
      }
    }
    const list = vocabList(kind);
    const index = list.findIndex((value) => value.id === id);
    list.splice(index, 1);
    if (current.isDefault) {
      const next = sortVocab(list)[0];
      if (next) next.isDefault = true;
    }
    return { reassigned: reassignToId ? count : 0 };
  }

  const supabase = createServiceClient();
  const table = kind === "status" ? "inventory_statuses" : "inventory_storage_states";
  const column = kind === "status" ? "status_id" : "storage_state_id";
  if (reassignToId && count > 0) {
    const { error } = await supabase
      .from("inventory_items")
      .update({ [column]: reassignToId })
      .eq(column, id);
    if (error) throw error;
  }
  if (current.isDefault && reassignToId) {
    await supabase.from(table).update({ is_default: true }).eq("id", reassignToId);
  }
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
  if (current.isDefault && !reassignToId) {
    const remaining = sortVocab(values.filter((value) => value.id !== id));
    const next = remaining[0];
    if (next) await supabase.from(table).update({ is_default: true }).eq("id", next.id);
  }
  return { reassigned: reassignToId ? count : 0 };
}

async function countVocabReferences(kind: InventoryVocabKind, id: string): Promise<number> {
  const supabase = createServiceClient();
  const column = kind === "status" ? "status_id" : "storage_state_id";
  const { count, error } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq(column, id)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
