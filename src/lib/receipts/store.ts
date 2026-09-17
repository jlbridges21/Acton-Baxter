/**
 * Receipt Log persistence — service-role writes; memory store for tests/mock.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import type {
  ExpenseJob,
  ExpenseJobCreateCustomInput,
  ExpenseJobUpdateInput,
  Receipt,
  ReceiptCreateInput,
} from "./types";

export type ExpenseJobRow = {
  id: string;
  label: string;
  project_number: string | null;
  source: "project" | "custom";
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptRow = {
  id: string;
  submitted_by: string;
  job_id: string;
  amount_cents: number;
  vendor: string;
  purchased_on: string;
  items: string | null;
  description: string | null;
  photo_storage_path: string | null;
  extraction: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type MemoryState = {
  jobs: Map<string, ExpenseJobRow>;
  receipts: Map<string, ReceiptRow>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterReceiptLog?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterReceiptLog) {
    globalMemory.__baxterReceiptLog = {
      jobs: new Map(),
      receipts: new Map(),
    };
  }
  return globalMemory.__baxterReceiptLog;
}

export function resetReceiptLogMemoryForTests() {
  globalMemory.__baxterReceiptLog = {
    jobs: new Map(),
    receipts: new Map(),
  };
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

export function mapExpenseJob(row: ExpenseJobRow): ExpenseJob {
  return {
    id: row.id,
    label: row.label,
    projectNumber: row.project_number,
    source: row.source,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    submittedBy: row.submitted_by,
    jobId: row.job_id,
    amountCents: row.amount_cents,
    vendor: row.vendor,
    purchasedOn: row.purchased_on,
    items: row.items,
    description: row.description,
    photoStoragePath: row.photo_storage_path,
    extraction: row.extraction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const message = (record.message ?? "").toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

export async function listExpenseJobsRaw(options?: {
  includeInactive?: boolean;
}): Promise<ExpenseJobRow[]> {
  if (shouldUseMemory()) {
    const rows = Array.from(getMemory().jobs.values()).filter(
      (j) => options?.includeInactive || j.is_active,
    );
    return rows.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }

  const supabase = createServiceClient();
  let query = supabase.from("expense_jobs").select("*");
  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data as ExpenseJobRow[]) ?? [];
}

export async function listExpenseJobs(options?: {
  includeInactive?: boolean;
}): Promise<ExpenseJob[]> {
  const rows = await listExpenseJobsRaw(options);
  return rows.map(mapExpenseJob);
}

export async function getExpenseJob(id: string): Promise<ExpenseJob | null> {
  if (shouldUseMemory()) {
    const row = getMemory().jobs.get(id);
    return row ? mapExpenseJob(row) : null;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expense_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data ? mapExpenseJob(data as ExpenseJobRow) : null;
}

/**
 * Upsert a project-sourced job by project_number.
 * Preserves is_active and sort_order when the row already exists.
 */
export async function upsertProjectExpenseJob(input: {
  projectNumber: string;
  label: string;
  updatedBy?: string | null;
}): Promise<ExpenseJobRow> {
  const projectNumber = input.projectNumber.trim();
  const label = input.label.trim();
  if (!projectNumber || !label) {
    throw new ValidationError("Project number and label are required");
  }

  if (shouldUseMemory()) {
    const mem = getMemory();
    const existing = Array.from(mem.jobs.values()).find(
      (j) =>
        j.source === "project" && j.project_number?.toUpperCase() === projectNumber.toUpperCase(),
    );
    if (existing) {
      const next: ExpenseJobRow = {
        ...existing,
        label,
        updated_by: input.updatedBy ?? existing.updated_by,
        updated_at: nowIso(),
      };
      mem.jobs.set(existing.id, next);
      return next;
    }
    const maxSort = Array.from(mem.jobs.values()).reduce((m, j) => Math.max(m, j.sort_order), 0);
    const row: ExpenseJobRow = {
      id: randomUUID(),
      label,
      project_number: projectNumber,
      source: "project",
      is_active: true,
      sort_order: maxSort + 10,
      created_by: input.updatedBy ?? null,
      updated_by: input.updatedBy ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    mem.jobs.set(row.id, row);
    return row;
  }

  const supabase = createServiceClient();
  const { data: existing, error: findError } = await supabase
    .from("expense_jobs")
    .select("*")
    .eq("source", "project")
    .eq("project_number", projectNumber)
    .maybeSingle();
  if (findError && !isMissingTable(findError)) throw findError;

  if (existing) {
    const { data, error } = await supabase
      .from("expense_jobs")
      .update({
        label,
        updated_by: input.updatedBy ?? null,
        updated_at: nowIso(),
      })
      .eq("id", (existing as ExpenseJobRow).id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ExpenseJobRow;
  }

  const { data: maxRow } = await supabase
    .from("expense_jobs")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("expense_jobs")
    .insert({
      label,
      project_number: projectNumber,
      source: "project",
      is_active: true,
      sort_order: nextSort,
      created_by: input.updatedBy ?? null,
      updated_by: input.updatedBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ExpenseJobRow;
}

export async function createCustomExpenseJob(
  input: ExpenseJobCreateCustomInput,
): Promise<ExpenseJob> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Label is required");

  if (shouldUseMemory()) {
    const mem = getMemory();
    const maxSort = Array.from(mem.jobs.values()).reduce((m, j) => Math.max(m, j.sort_order), 0);
    const row: ExpenseJobRow = {
      id: randomUUID(),
      label,
      project_number: null,
      source: "custom",
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? maxSort + 10,
      created_by: input.createdBy,
      updated_by: input.createdBy,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    mem.jobs.set(row.id, row);
    return mapExpenseJob(row);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expense_jobs")
    .insert({
      label,
      project_number: null,
      source: "custom",
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? 0,
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapExpenseJob(data as ExpenseJobRow);
}

export async function updateExpenseJob(input: ExpenseJobUpdateInput): Promise<ExpenseJob> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const existing = mem.jobs.get(input.id);
    if (!existing) throw new ValidationError("Job not found");
    const next: ExpenseJobRow = {
      ...existing,
      label: input.label?.trim() || existing.label,
      is_active: input.isActive ?? existing.is_active,
      sort_order: input.sortOrder ?? existing.sort_order,
      updated_by: input.updatedBy,
      updated_at: nowIso(),
    };
    mem.jobs.set(input.id, next);
    return mapExpenseJob(next);
  }

  const patch: Record<string, unknown> = {
    updated_by: input.updatedBy,
    updated_at: nowIso(),
  };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expense_jobs")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return mapExpenseJob(data as ExpenseJobRow);
}

export async function reorderExpenseJobs(orderedIds: string[], updatedBy: string): Promise<void> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    orderedIds.forEach((id, index) => {
      const row = mem.jobs.get(id);
      if (row) {
        mem.jobs.set(id, {
          ...row,
          sort_order: (index + 1) * 10,
          updated_by: updatedBy,
          updated_at: nowIso(),
        });
      }
    });
    return;
  }

  const supabase = createServiceClient();
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from("expense_jobs")
      .update({
        sort_order: (i + 1) * 10,
        updated_by: updatedBy,
        updated_at: nowIso(),
      })
      .eq("id", id);
    if (error) throw error;
  }
}

export async function createReceipt(input: ReceiptCreateInput): Promise<Receipt> {
  if (!input.jobId) throw new ValidationError("Job is required");
  if (!input.amountCents || input.amountCents <= 0) {
    throw new ValidationError("Amount must be greater than zero");
  }
  if (!Number.isInteger(input.amountCents)) {
    throw new ValidationError("Amount must be stored as integer cents");
  }
  const vendor = input.vendor.trim();
  if (!vendor) throw new ValidationError("Vendor is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) {
    throw new ValidationError("Date purchased is required");
  }

  const job = await getExpenseJob(input.jobId);
  if (!job || !job.isActive) {
    throw new ValidationError("Select an active job");
  }

  const items = input.items?.trim() || null;
  const description = input.description?.trim() || null;

  if (shouldUseMemory()) {
    const row: ReceiptRow = {
      id: randomUUID(),
      submitted_by: input.submittedBy,
      job_id: input.jobId,
      amount_cents: input.amountCents,
      vendor,
      purchased_on: input.purchasedOn,
      items,
      description,
      photo_storage_path: input.photoStoragePath ?? null,
      extraction: input.extraction ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      deleted_at: null,
    };
    getMemory().receipts.set(row.id, row);
    return mapReceipt(row);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("receipts")
    .insert({
      submitted_by: input.submittedBy,
      job_id: input.jobId,
      amount_cents: input.amountCents,
      vendor,
      purchased_on: input.purchasedOn,
      items,
      description,
      photo_storage_path: input.photoStoragePath ?? null,
      extraction: input.extraction ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapReceipt(data as ReceiptRow);
}

export async function listReceiptsForUser(userId: string): Promise<Receipt[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().receipts.values())
      .filter((r) => r.submitted_by === userId && !r.deleted_at)
      .map(mapReceipt);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("submitted_by", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return ((data as ReceiptRow[]) ?? []).map(mapReceipt);
}

const DUPLICATE_WINDOW_DAYS = 3;

function normalizeVendorKey(vendor: string): string {
  return vendor.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Soft duplicate check: same user + same vendor + same amount within a few days.
 * Warns in the UI — never blocks submit.
 */
export async function findRecentDuplicateReceipt(input: {
  userId: string;
  vendor: string;
  amountCents: number;
  withinDays?: number;
}): Promise<Receipt | null> {
  const vendorKey = normalizeVendorKey(input.vendor);
  if (!vendorKey || input.amountCents <= 0) return null;
  const days = input.withinDays ?? DUPLICATE_WINDOW_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (shouldUseMemory()) {
    const matches = Array.from(getMemory().receipts.values())
      .filter(
        (r) =>
          r.submitted_by === input.userId &&
          !r.deleted_at &&
          r.amount_cents === input.amountCents &&
          normalizeVendorKey(r.vendor) === vendorKey &&
          r.created_at >= cutoff,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return matches[0] ? mapReceipt(matches[0]) : null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("submitted_by", input.userId)
    .eq("amount_cents", input.amountCents)
    .is("deleted_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  const row = ((data as ReceiptRow[]) ?? []).find(
    (r) => normalizeVendorKey(r.vendor) === vendorKey,
  );
  return row ? mapReceipt(row) : null;
}

/** Admin: list all non-deleted receipts (for the next prompt's log view). */
export async function listAllReceipts(): Promise<Receipt[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().receipts.values())
      .filter((r) => !r.deleted_at)
      .map(mapReceipt);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return ((data as ReceiptRow[]) ?? []).map(mapReceipt);
}

/**
 * Application-level ownership check mirroring RLS (for tests / defense in depth).
 * Returns null when the viewer may not see the row.
 */
export function filterReceiptVisibleToViewer(
  receipt: Receipt,
  viewer: { id: string; isAdmin: boolean },
): Receipt | null {
  if (receipt.deletedAt) return null;
  if (viewer.isAdmin) return receipt;
  if (receipt.submittedBy === viewer.id) return receipt;
  return null;
}
