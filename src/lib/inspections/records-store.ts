/**
 * Site inspection visit persistence — service-role writes; memory for tests/mock.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatHumanDisplayName } from "@/lib/pem-neat/display-name";
import { isAdminRole } from "@/lib/auth/roles";
import { getTemplate } from "./store";
import {
  buildInspectionSnapshot,
  countSnapshotItems,
  findCoverPhotoItem,
  type InspectionSnapshot,
} from "./snapshot";
import {
  createSignedUploadForPath,
  createSiteInspectionMediaSignedUrl,
  createSiteInspectionMediaSignedUrlMap,
  deleteSiteInspectionMediaObject,
} from "./media-storage";
import {
  SITE_INSPECTION_MEDIA_BUCKET,
  type CreateSiteInspectionInput,
  type SiteInspectionDetail,
  type SiteInspectionMedia,
  type SiteInspectionResponse,
  type SiteInspectionStatus,
  type SiteInspectionSummary,
  type SubQuestionAnswer,
  type UpsertResponseInput,
} from "./record-types";

type InspectionRow = {
  id: string;
  project_name: string;
  address: string;
  job_id: string | null;
  assigned_to: string | null;
  source_template_id: string | null;
  snapshot_json: InspectionSnapshot;
  status: SiteInspectionStatus;
  cover_media_id: string | null;
  total_item_count: number;
  completed_item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ResponseRow = {
  id: string;
  inspection_id: string;
  snapshot_item_id: string;
  is_complete: boolean;
  notes: string;
  answers: Record<string, SubQuestionAnswer>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type MediaRow = {
  id: string;
  inspection_id: string;
  snapshot_item_id: string;
  client_media_id: string | null;
  storage_path: string | null;
  media_type: "photo" | "video";
  sort_order: number;
  upload_status: "pending" | "uploading" | "ready" | "failed";
  upload_progress: number | null;
  mime_type: string | null;
  byte_size: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryState = {
  inspections: Map<string, InspectionRow>;
  responses: Map<string, ResponseRow>;
  media: Map<string, MediaRow>;
  profileNames: Map<string, string>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSiteInspections?: MemoryState;
};

function emptyMemory(): MemoryState {
  return {
    inspections: new Map(),
    responses: new Map(),
    media: new Map(),
    profileNames: new Map(),
  };
}

function getMemory(): MemoryState {
  if (!globalMemory.__baxterSiteInspections) {
    globalMemory.__baxterSiteInspections = emptyMemory();
  }
  return globalMemory.__baxterSiteInspections;
}

export function resetSiteInspectionMemoryForTests() {
  globalMemory.__baxterSiteInspections = emptyMemory();
}

export function setSiteInspectionProfileNameForTests(userId: string, name: string) {
  getMemory().profileNames.set(userId, name);
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

function mapResponse(row: ResponseRow): SiteInspectionResponse {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    snapshotItemId: row.snapshot_item_id,
    isComplete: row.is_complete,
    notes: row.notes,
    answers: row.answers ?? {},
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow, signedUrl?: string | null): SiteInspectionMedia {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    snapshotItemId: row.snapshot_item_id,
    clientMediaId: row.client_media_id,
    storagePath: row.storage_path,
    mediaType: row.media_type,
    sortOrder: row.sort_order,
    uploadStatus: row.upload_status,
    uploadProgress: row.upload_progress,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    signedUrl: signedUrl ?? null,
  };
}

async function resolveProfileName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  if (shouldUseMemory()) {
    const name = getMemory().profileNames.get(userId);
    return name ? formatHumanDisplayName(name) : formatHumanDisplayName(userId.slice(0, 8));
  }
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return formatHumanDisplayName((data?.full_name as string | null)?.trim() || "Teammate");
}

/** One profiles query for all assignee/creator ids on the card list. */
async function resolveProfileNamesBatch(
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(userIds.filter((id): id is string => Boolean(id && id.trim()))),
  );
  const map = new Map<string, string>();
  if (!unique.length) return map;

  if (shouldUseMemory()) {
    for (const id of unique) {
      const name = getMemory().profileNames.get(id);
      map.set(id, name ? formatHumanDisplayName(name) : formatHumanDisplayName(id.slice(0, 8)));
    }
    return map;
  }

  const supabase = createServiceClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  const found = new Set<string>();
  for (const row of data ?? []) {
    const id = row.id as string;
    found.add(id);
    map.set(id, formatHumanDisplayName((row.full_name as string | null)?.trim() || "Teammate"));
  }
  for (const id of unique) {
    if (!found.has(id)) map.set(id, formatHumanDisplayName("Teammate"));
  }
  return map;
}

function countMediaStatuses(media: MediaRow[]): { pending: number; failed: number } {
  let pending = 0;
  let failed = 0;
  for (const m of media) {
    if (m.upload_status === "pending" || m.upload_status === "uploading") pending += 1;
    if (m.upload_status === "failed") failed += 1;
  }
  return { pending, failed };
}

const LIST_COLUMNS =
  "id, project_name, address, job_id, assigned_to, source_template_id, status, cover_media_id, total_item_count, completed_item_count, created_by, created_at, updated_at, deleted_at";

type InspectionListRow = {
  id: string;
  project_name: string;
  address: string;
  job_id: string | null;
  assigned_to: string | null;
  source_template_id: string | null;
  status: SiteInspectionStatus;
  cover_media_id: string | null;
  total_item_count: number;
  completed_item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function mapSummaryFromListRow(
  row: InspectionListRow,
  coverSignedUrl: string | null,
  pendingMediaCount: number,
  failedMediaCount: number,
  nameById: Map<string, string>,
): SiteInspectionSummary {
  return {
    id: row.id,
    projectName: row.project_name,
    address: row.address,
    jobId: row.job_id,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to ? (nameById.get(row.assigned_to) ?? null) : null,
    sourceTemplateId: row.source_template_id,
    status: row.status,
    coverMediaId: row.cover_media_id,
    coverSignedUrl,
    totalItemCount: row.total_item_count,
    completedItemCount: row.completed_item_count,
    pendingMediaCount,
    failedMediaCount,
    createdBy: row.created_by,
    createdByName: nameById.get(row.created_by) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function mapSummary(
  row: InspectionRow,
  coverSignedUrl: string | null,
  pendingMediaCount = 0,
  failedMediaCount = 0,
): Promise<SiteInspectionSummary> {
  const [assignedToName, createdByName] = await Promise.all([
    resolveProfileName(row.assigned_to),
    resolveProfileName(row.created_by),
  ]);
  return {
    id: row.id,
    projectName: row.project_name,
    address: row.address,
    jobId: row.job_id,
    assignedTo: row.assigned_to,
    assignedToName,
    sourceTemplateId: row.source_template_id,
    status: row.status,
    coverMediaId: row.cover_media_id,
    coverSignedUrl,
    totalItemCount: row.total_item_count,
    completedItemCount: row.completed_item_count,
    pendingMediaCount,
    failedMediaCount,
    createdBy: row.created_by,
    createdByName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSiteInspection(
  input: CreateSiteInspectionInput,
): Promise<SiteInspectionDetail> {
  const projectName = input.projectName.trim();
  const address = input.address.trim();
  if (!projectName) throw new ValidationError("Project name is required");
  if (!address) throw new ValidationError("Address is required");

  const template = await getTemplate(input.templateId);
  if (template.archivedAt) {
    throw new ValidationError("Choose an active template");
  }

  const snapshot = buildInspectionSnapshot(template);
  const total = countSnapshotItems(snapshot);
  const id = randomUUID();
  const now = nowIso();
  const row: InspectionRow = {
    id,
    project_name: projectName,
    address,
    job_id: input.jobId ?? null,
    assigned_to: input.assignedTo ?? null,
    source_template_id: template.id,
    snapshot_json: snapshot,
    status: "pending",
    cover_media_id: null,
    total_item_count: total,
    completed_item_count: 0,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  if (shouldUseMemory()) {
    getMemory().inspections.set(id, row);
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("site_inspections").insert({
      id: row.id,
      project_name: row.project_name,
      address: row.address,
      job_id: row.job_id,
      assigned_to: row.assigned_to,
      source_template_id: row.source_template_id,
      snapshot_json: row.snapshot_json,
      status: row.status,
      cover_media_id: row.cover_media_id,
      total_item_count: row.total_item_count,
      completed_item_count: row.completed_item_count,
      created_by: row.created_by,
    });
    if (error) throw error;
  }

  return getSiteInspection(id);
}

export async function listSiteInspections(options?: {
  query?: string;
  status?: SiteInspectionStatus | "all";
}): Promise<SiteInspectionSummary[]> {
  const q = options?.query?.trim().toLowerCase() ?? "";
  const statusFilter = options?.status ?? "all";

  let rows: InspectionListRow[] = [];
  if (shouldUseMemory()) {
    rows = Array.from(getMemory().inspections.values())
      .filter((r) => !r.deleted_at)
      .map((r) => ({
        id: r.id,
        project_name: r.project_name,
        address: r.address,
        job_id: r.job_id,
        assigned_to: r.assigned_to,
        source_template_id: r.source_template_id,
        status: r.status,
        cover_media_id: r.cover_media_id,
        total_item_count: r.total_item_count,
        completed_item_count: r.completed_item_count,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
      }));
  } else {
    const supabase = createServiceClient();
    // Never select snapshot_json on the card list — it dwarfs every other column.
    const { data, error } = await supabase
      .from("site_inspections")
      .select(LIST_COLUMNS)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    rows = (data ?? []) as InspectionListRow[];
  }

  rows = rows
    .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
    .filter((r) => {
      if (!q) return true;
      return r.project_name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const coverPaths: string[] = [];
  const coverPathById = new Map<string, string>();
  if (shouldUseMemory()) {
    for (const row of rows) {
      if (!row.cover_media_id) continue;
      const media = getMemory().media.get(row.cover_media_id);
      if (media?.storage_path) {
        coverPaths.push(media.storage_path);
        coverPathById.set(row.id, media.storage_path);
      }
    }
  } else {
    const coverIds = rows.map((r) => r.cover_media_id).filter(Boolean) as string[];
    if (coverIds.length) {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("site_inspection_media")
        .select("id, storage_path, inspection_id")
        .in("id", coverIds);
      for (const m of data ?? []) {
        if (m.storage_path) {
          coverPaths.push(m.storage_path as string);
          coverPathById.set(m.inspection_id as string, m.storage_path as string);
        }
      }
    }
  }

  const [urlMap, nameById, mediaStatusByInspection] = await Promise.all([
    createSiteInspectionMediaSignedUrlMap(coverPaths, 600),
    resolveProfileNamesBatch(rows.flatMap((r) => [r.assigned_to, r.created_by])),
    (async () => {
      const map = new Map<string, { pending: number; failed: number }>();
      if (shouldUseMemory()) {
        for (const row of rows) {
          const media = Array.from(getMemory().media.values()).filter(
            (m) => m.inspection_id === row.id,
          );
          map.set(row.id, countMediaStatuses(media));
        }
      } else if (rows.length) {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("site_inspection_media")
          .select("inspection_id, upload_status")
          .in(
            "inspection_id",
            rows.map((r) => r.id),
          );
        for (const m of data ?? []) {
          const id = m.inspection_id as string;
          const cur = map.get(id) ?? { pending: 0, failed: 0 };
          if (m.upload_status === "pending" || m.upload_status === "uploading") cur.pending += 1;
          if (m.upload_status === "failed") cur.failed += 1;
          map.set(id, cur);
        }
      }
      return map;
    })(),
  ]);

  return rows.map((row) => {
    const path = coverPathById.get(row.id);
    const counts = mediaStatusByInspection.get(row.id) ?? { pending: 0, failed: 0 };
    return mapSummaryFromListRow(
      row,
      path ? (urlMap.get(path) ?? null) : null,
      counts.pending,
      counts.failed,
      nameById,
    );
  });
}

async function loadInspectionRow(id: string): Promise<InspectionRow> {
  if (shouldUseMemory()) {
    const row = getMemory().inspections.get(id);
    if (!row || row.deleted_at) throw new NotFoundError("Inspection not found");
    return row;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("site_inspections")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Inspection not found");
  return data as InspectionRow;
}

export async function getSiteInspection(id: string): Promise<SiteInspectionDetail> {
  const row = await loadInspectionRow(id);

  let responses: ResponseRow[] = [];
  let media: MediaRow[] = [];
  if (shouldUseMemory()) {
    const mem = getMemory();
    responses = Array.from(mem.responses.values()).filter((r) => r.inspection_id === id);
    media = Array.from(mem.media.values())
      .filter((m) => m.inspection_id === id)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  } else {
    const supabase = createServiceClient();
    const [{ data: responseRows, error: rErr }, { data: mediaRows, error: mErr }] =
      await Promise.all([
        supabase.from("site_inspection_responses").select("*").eq("inspection_id", id),
        supabase
          .from("site_inspection_media")
          .select("*")
          .eq("inspection_id", id)
          .order("sort_order", { ascending: true }),
      ]);
    if (rErr) throw rErr;
    if (mErr) throw mErr;
    responses = (responseRows ?? []) as ResponseRow[];
    media = (mediaRows ?? []) as MediaRow[];
  }

  const paths = media.map((m) => m.storage_path).filter(Boolean) as string[];
  const urlMap = await createSiteInspectionMediaSignedUrlMap(paths, 600);
  let coverSignedUrl: string | null = null;
  if (row.cover_media_id) {
    const cover = media.find((m) => m.id === row.cover_media_id);
    if (cover?.storage_path) coverSignedUrl = urlMap.get(cover.storage_path) ?? null;
  }

  const summary = await mapSummary(
    row,
    coverSignedUrl,
    countMediaStatuses(media).pending,
    countMediaStatuses(media).failed,
  );
  return {
    ...summary,
    snapshot: row.snapshot_json,
    responses: responses.map(mapResponse),
    media: media.map((m) => mapMedia(m, m.storage_path ? urlMap.get(m.storage_path) : null)),
  };
}

async function recountProgress(inspectionId: string): Promise<void> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.inspections.get(inspectionId);
    if (!row) return;
    const completed = Array.from(mem.responses.values()).filter(
      (r) => r.inspection_id === inspectionId && r.is_complete,
    ).length;
    // Status is set only via explicit complete/reopen — never derived from checkboxes.
    mem.inspections.set(inspectionId, {
      ...row,
      completed_item_count: completed,
      updated_at: nowIso(),
    });
    return;
  }
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("site_inspection_responses")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId)
    .eq("is_complete", true);
  const completed = count ?? 0;
  await supabase
    .from("site_inspections")
    .update({
      completed_item_count: completed,
    })
    .eq("id", inspectionId);
}

/**
 * Explicitly set inspection status (complete / reopen to pending).
 * Completing is refused while media uploads are pending or failed.
 */
export async function setSiteInspectionStatus(input: {
  inspectionId: string;
  status: SiteInspectionStatus;
  actorId: string;
}): Promise<SiteInspectionDetail> {
  void input.actorId;
  await loadInspectionRow(input.inspectionId);

  if (input.status === "complete") {
    let media: MediaRow[] = [];
    if (shouldUseMemory()) {
      media = Array.from(getMemory().media.values()).filter(
        (m) => m.inspection_id === input.inspectionId,
      );
    } else {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("site_inspection_media")
        .select("*")
        .eq("inspection_id", input.inspectionId);
      if (error) throw error;
      media = (data ?? []) as MediaRow[];
    }
    const { pending, failed } = countMediaStatuses(media);
    if (failed > 0) {
      throw new ValidationError(
        `${failed} upload${failed === 1 ? "" : "s"} failed. Retry or discard each failed upload before completing.`,
      );
    }
    if (pending > 0) {
      throw new ValidationError(
        `${pending} upload${pending === 1 ? "" : "s"} still pending. Wait for uploads to finish before completing.`,
      );
    }
  }

  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.inspections.get(input.inspectionId);
    if (!row) throw new NotFoundError("Inspection not found");
    mem.inspections.set(input.inspectionId, {
      ...row,
      status: input.status,
      updated_at: nowIso(),
    });
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("site_inspections")
      .update({ status: input.status })
      .eq("id", input.inspectionId);
    if (error) throw error;
  }

  return getSiteInspection(input.inspectionId);
}

/**
 * Batch-sign URLs for media on one checklist item (gallery refresh).
 */
export async function getSignedUrlsForInspectionItem(input: {
  inspectionId: string;
  snapshotItemId: string;
  expiresInSeconds?: number;
}): Promise<{
  urls: Record<string, string>;
  expiresAt: string;
  expiresInSeconds: number;
}> {
  const row = await loadInspectionRow(input.inspectionId);
  assertItemInSnapshot(row.snapshot_json, input.snapshotItemId);

  let media: MediaRow[] = [];
  if (shouldUseMemory()) {
    media = Array.from(getMemory().media.values()).filter(
      (m) => m.inspection_id === input.inspectionId && m.snapshot_item_id === input.snapshotItemId,
    );
  } else {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("site_inspection_media")
      .select("*")
      .eq("inspection_id", input.inspectionId)
      .eq("snapshot_item_id", input.snapshotItemId);
    if (error) throw error;
    media = (data ?? []) as MediaRow[];
  }

  const expiresInSeconds = input.expiresInSeconds ?? 600;
  const paths = media.map((m) => m.storage_path).filter(Boolean) as string[];
  const urlMap = await createSiteInspectionMediaSignedUrlMap(paths, expiresInSeconds);
  const urls: Record<string, string> = {};
  for (const m of media) {
    if (m.storage_path && urlMap.has(m.storage_path)) {
      urls[m.id] = urlMap.get(m.storage_path)!;
      if (m.client_media_id) urls[m.client_media_id] = urlMap.get(m.storage_path)!;
    }
  }
  return {
    urls,
    expiresInSeconds,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
}

function assertItemInSnapshot(snapshot: InspectionSnapshot, snapshotItemId: string) {
  const items = [...snapshot.standaloneItems, ...snapshot.sections.flatMap((s) => s.items)];
  const item = items.find((i) => i.id === snapshotItemId);
  if (!item) throw new ValidationError("Unknown checklist item for this inspection");
  return item;
}

export async function upsertSiteInspectionResponse(
  input: UpsertResponseInput,
): Promise<SiteInspectionDetail> {
  const inspection = await loadInspectionRow(input.inspectionId);
  assertItemInSnapshot(inspection.snapshot_json, input.snapshotItemId);

  if (shouldUseMemory()) {
    const mem = getMemory();
    const existing = Array.from(mem.responses.values()).find(
      (r) => r.inspection_id === input.inspectionId && r.snapshot_item_id === input.snapshotItemId,
    );
    const now = nowIso();
    if (existing) {
      mem.responses.set(existing.id, {
        ...existing,
        is_complete: input.isComplete ?? existing.is_complete,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        answers: input.answers ? { ...existing.answers, ...input.answers } : existing.answers,
        updated_by: input.actorId,
        updated_at: now,
      });
    } else {
      const id = randomUUID();
      mem.responses.set(id, {
        id,
        inspection_id: input.inspectionId,
        snapshot_item_id: input.snapshotItemId,
        is_complete: input.isComplete ?? false,
        notes: input.notes ?? "",
        answers: input.answers ?? {},
        updated_by: input.actorId,
        created_at: now,
        updated_at: now,
      });
    }
  } else {
    const supabase = createServiceClient();
    const { data: existing } = await supabase
      .from("site_inspection_responses")
      .select("*")
      .eq("inspection_id", input.inspectionId)
      .eq("snapshot_item_id", input.snapshotItemId)
      .maybeSingle();

    if (existing) {
      const nextAnswers = input.answers
        ? { ...(existing.answers as object), ...input.answers }
        : existing.answers;
      const { error } = await supabase
        .from("site_inspection_responses")
        .update({
          is_complete: input.isComplete ?? existing.is_complete,
          notes: input.notes !== undefined ? input.notes : existing.notes,
          answers: nextAnswers,
          updated_by: input.actorId,
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("site_inspection_responses").insert({
        inspection_id: input.inspectionId,
        snapshot_item_id: input.snapshotItemId,
        is_complete: input.isComplete ?? false,
        notes: input.notes ?? "",
        answers: input.answers ?? {},
        updated_by: input.actorId,
      });
      if (error) throw error;
    }
  }

  await recountProgress(input.inspectionId);
  return getSiteInspection(input.inspectionId);
}

/**
 * Prepare a media slot for direct-to-storage upload (bytes never hit this server).
 * Photos: signed upload URL. Videos: TUS resumable endpoint + object path.
 */
export async function prepareSiteInspectionMedia(input: {
  inspectionId: string;
  snapshotItemId: string;
  clientMediaId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  byteSize: number;
  actorId: string;
}): Promise<{
  media: SiteInspectionMedia;
  upload:
    | { mode: "signed"; path: string; token: string; signedUrl: string }
    | { mode: "tus"; path: string; bucket: string; tusEndpoint: string }
    | { mode: "memory"; path: string };
}> {
  const inspection = await loadInspectionRow(input.inspectionId);
  const item = assertItemInSnapshot(inspection.snapshot_json, input.snapshotItemId);
  if (!item.allowsMedia) throw new ValidationError("This item does not allow media");
  if (!input.clientMediaId.trim()) throw new ValidationError("clientMediaId is required");

  const ext =
    input.mediaType === "video"
      ? input.mimeType.includes("quicktime")
        ? "mov"
        : "mp4"
      : input.mimeType.includes("png")
        ? "png"
        : input.mimeType.includes("webp")
          ? "webp"
          : "jpg";
  const storagePath = `${input.actorId}/${input.inspectionId}/${input.clientMediaId}.${ext}`;
  const now = nowIso();
  let id: string = randomUUID();
  let sortOrder = 0;

  if (shouldUseMemory()) {
    const mem = getMemory();
    const existing = Array.from(mem.media.values()).find(
      (m) => m.inspection_id === input.inspectionId && m.client_media_id === input.clientMediaId,
    );
    if (existing) {
      id = existing.id;
      sortOrder = existing.sort_order;
      mem.media.set(id, {
        ...existing,
        storage_path: storagePath,
        media_type: input.mediaType,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        upload_status: "pending",
        upload_progress: 0,
        updated_at: now,
      });
    } else {
      const siblings = Array.from(mem.media.values()).filter(
        (m) =>
          m.inspection_id === input.inspectionId && m.snapshot_item_id === input.snapshotItemId,
      );
      sortOrder = siblings.length;
      mem.media.set(id, {
        id,
        inspection_id: input.inspectionId,
        snapshot_item_id: input.snapshotItemId,
        client_media_id: input.clientMediaId,
        storage_path: storagePath,
        media_type: input.mediaType,
        sort_order: sortOrder,
        upload_status: "pending",
        upload_progress: 0,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        created_by: input.actorId,
        created_at: now,
        updated_at: now,
      });
    }
  } else {
    const supabase = createServiceClient();
    const { data: existing } = await supabase
      .from("site_inspection_media")
      .select("*")
      .eq("inspection_id", input.inspectionId)
      .eq("client_media_id", input.clientMediaId)
      .maybeSingle();
    if (existing) {
      id = existing.id as string;
      sortOrder = existing.sort_order as number;
      await supabase
        .from("site_inspection_media")
        .update({
          storage_path: storagePath,
          media_type: input.mediaType,
          mime_type: input.mimeType,
          byte_size: input.byteSize,
          upload_status: "pending",
          upload_progress: 0,
        })
        .eq("id", id);
    } else {
      const { count } = await supabase
        .from("site_inspection_media")
        .select("id", { count: "exact", head: true })
        .eq("inspection_id", input.inspectionId)
        .eq("snapshot_item_id", input.snapshotItemId);
      sortOrder = count ?? 0;
      const { error } = await supabase.from("site_inspection_media").insert({
        id,
        inspection_id: input.inspectionId,
        snapshot_item_id: input.snapshotItemId,
        client_media_id: input.clientMediaId,
        storage_path: storagePath,
        media_type: input.mediaType,
        sort_order: sortOrder,
        upload_status: "pending",
        upload_progress: 0,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        created_by: input.actorId,
      });
      if (error) throw error;
    }
  }

  const detail = await getSiteInspection(input.inspectionId);
  const media = detail.media.find((m) => m.id === id)!;

  if (shouldUseMemory()) {
    return { media, upload: { mode: "memory", path: storagePath } };
  }

  if (input.mediaType === "photo") {
    const signed = await createSignedUploadForPath(storagePath);
    return {
      media,
      upload: {
        mode: "signed",
        path: storagePath,
        token: signed.token,
        signedUrl: signed.signedUrl,
      },
    };
  }

  const tusEndpoint = `${getEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  return {
    media,
    upload: {
      mode: "tus",
      path: storagePath,
      bucket: SITE_INSPECTION_MEDIA_BUCKET,
      tusEndpoint,
    },
  };
}

export async function completeSiteInspectionMedia(input: {
  inspectionId: string;
  clientMediaId: string;
  storagePath?: string;
  byteSize?: number;
  actorId: string;
}): Promise<SiteInspectionDetail> {
  const inspection = await loadInspectionRow(input.inspectionId);
  let mediaId: string | null = null;
  let snapshotItemId: string | null = null;
  let sortOrder = 0;
  let mediaType: "photo" | "video" = "photo";

  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = Array.from(mem.media.values()).find(
      (m) => m.inspection_id === input.inspectionId && m.client_media_id === input.clientMediaId,
    );
    if (!row) throw new NotFoundError("Media not found");
    mediaId = row.id;
    snapshotItemId = row.snapshot_item_id;
    sortOrder = row.sort_order;
    mediaType = row.media_type;
    mem.media.set(row.id, {
      ...row,
      storage_path: input.storagePath ?? row.storage_path,
      byte_size: input.byteSize ?? row.byte_size,
      upload_status: "ready",
      upload_progress: 1,
      updated_at: nowIso(),
    });
  } else {
    const supabase = createServiceClient();
    const { data: row, error } = await supabase
      .from("site_inspection_media")
      .select("*")
      .eq("inspection_id", input.inspectionId)
      .eq("client_media_id", input.clientMediaId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new NotFoundError("Media not found");
    mediaId = row.id as string;
    snapshotItemId = row.snapshot_item_id as string;
    sortOrder = row.sort_order as number;
    mediaType = row.media_type as "photo" | "video";
    await supabase
      .from("site_inspection_media")
      .update({
        storage_path: input.storagePath ?? row.storage_path,
        byte_size: input.byteSize ?? row.byte_size,
        upload_status: "ready",
        upload_progress: 1,
      })
      .eq("id", mediaId);
  }

  const coverItem = findCoverPhotoItem(inspection.snapshot_json);
  if (
    coverItem &&
    snapshotItemId === coverItem.id &&
    mediaType === "photo" &&
    sortOrder === 0 &&
    mediaId
  ) {
    if (shouldUseMemory()) {
      const mem = getMemory();
      const row = mem.inspections.get(input.inspectionId)!;
      if (!row.cover_media_id) {
        mem.inspections.set(input.inspectionId, {
          ...row,
          cover_media_id: mediaId,
          updated_at: nowIso(),
        });
      }
    } else {
      const supabase = createServiceClient();
      const { data: current } = await supabase
        .from("site_inspections")
        .select("cover_media_id")
        .eq("id", input.inspectionId)
        .maybeSingle();
      if (!current?.cover_media_id) {
        await supabase
          .from("site_inspections")
          .update({ cover_media_id: mediaId })
          .eq("id", input.inspectionId);
      }
    }
  }

  return getSiteInspection(input.inspectionId);
}

export async function updateSiteInspectionMediaStatus(input: {
  inspectionId: string;
  clientMediaId: string;
  uploadStatus: "pending" | "uploading" | "ready" | "failed";
  uploadProgress?: number | null;
}): Promise<SiteInspectionDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = Array.from(mem.media.values()).find(
      (m) => m.inspection_id === input.inspectionId && m.client_media_id === input.clientMediaId,
    );
    if (row) {
      mem.media.set(row.id, {
        ...row,
        upload_status: input.uploadStatus,
        upload_progress:
          input.uploadProgress !== undefined ? input.uploadProgress : row.upload_progress,
        updated_at: nowIso(),
      });
    }
  } else {
    const supabase = createServiceClient();
    const patch: Record<string, unknown> = { upload_status: input.uploadStatus };
    if (input.uploadProgress !== undefined) patch.upload_progress = input.uploadProgress;
    const { error } = await supabase
      .from("site_inspection_media")
      .update(patch)
      .eq("inspection_id", input.inspectionId)
      .eq("client_media_id", input.clientMediaId);
    if (error) throw error;
  }
  return getSiteInspection(input.inspectionId);
}

/** @deprecated Interim sync path — prefer prepare + complete. Kept for tests during transition. */
export async function attachSiteInspectionPhoto(input: {
  inspectionId: string;
  snapshotItemId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  actorId: string;
  clientMediaId?: string;
}): Promise<SiteInspectionDetail> {
  const clientMediaId = input.clientMediaId ?? randomUUID();
  await prepareSiteInspectionMedia({
    inspectionId: input.inspectionId,
    snapshotItemId: input.snapshotItemId,
    clientMediaId,
    mediaType: "photo",
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    actorId: input.actorId,
  });
  return completeSiteInspectionMedia({
    inspectionId: input.inspectionId,
    clientMediaId,
    storagePath: input.storagePath,
    byteSize: input.byteSize,
    actorId: input.actorId,
  });
}

/**
 * Soft-delete an inspection (sets deleted_at). Creator or admin only.
 * User-facing lists/exports omit soft-deleted rows; storage cleanup is a follow-up.
 */
export async function softDeleteSiteInspection(
  id: string,
  actorId: string,
  actorRole?: string | null,
): Promise<void> {
  const row = await loadInspectionRow(id);
  const allowed = row.created_by === actorId || isAdminRole(actorRole);
  if (!allowed) {
    throw new AuthorizationError("Only the creator or an admin can delete this inspection");
  }

  if (shouldUseMemory()) {
    const mem = getMemory();
    const current = mem.inspections.get(id);
    if (!current) throw new NotFoundError("Inspection not found");
    mem.inspections.set(id, { ...current, deleted_at: nowIso(), updated_at: nowIso() });
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("site_inspections")
    .update({ deleted_at: nowIso() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Permanently remove one media row + storage object.
 * Allowed for the uploader or an admin (shared team records — anyone on the crew
 * who uploaded, or an admin cleaning up; not every teammate, to avoid accidental
 * wipe of someone else's shot).
 * `mediaId` may be the row UUID or the clientMediaId (optimistic / in-flight rows).
 * If the deleted row was the cover, falls back to the next ready photo on the cover item.
 */
export async function deleteSiteInspectionMedia(input: {
  inspectionId: string;
  mediaId: string;
  actorId: string;
  actorRole?: string | null;
}): Promise<SiteInspectionDetail> {
  const inspection = await loadInspectionRow(input.inspectionId);

  let row: MediaRow | null = null;
  if (shouldUseMemory()) {
    const mem = getMemory();
    const byId = mem.media.get(input.mediaId);
    if (byId && byId.inspection_id === input.inspectionId) {
      row = byId;
    } else {
      row =
        Array.from(mem.media.values()).find(
          (m) =>
            m.inspection_id === input.inspectionId &&
            (m.id === input.mediaId || m.client_media_id === input.mediaId),
        ) ?? null;
    }
  } else {
    const supabase = createServiceClient();
    const { data: byId, error: byIdError } = await supabase
      .from("site_inspection_media")
      .select("*")
      .eq("id", input.mediaId)
      .eq("inspection_id", input.inspectionId)
      .maybeSingle();
    if (byIdError) throw byIdError;
    if (byId) {
      row = byId as MediaRow;
    } else {
      const { data: byClient, error: byClientError } = await supabase
        .from("site_inspection_media")
        .select("*")
        .eq("client_media_id", input.mediaId)
        .eq("inspection_id", input.inspectionId)
        .maybeSingle();
      if (byClientError) throw byClientError;
      row = (byClient as MediaRow | null) ?? null;
    }
  }

  if (!row) throw new NotFoundError("Media not found");

  const allowed =
    isAdminRole(input.actorRole) ||
    row.created_by === input.actorId ||
    (!row.created_by && inspection.created_by === input.actorId);
  if (!allowed) {
    throw new AuthorizationError("Only the uploader or an admin can delete this media");
  }

  const storagePath = row.storage_path;
  const wasCover = inspection.cover_media_id === row.id;
  const coverItem = findCoverPhotoItem(inspection.snapshot_json);

  if (shouldUseMemory()) {
    const mem = getMemory();
    mem.media.delete(row.id);
    if (wasCover) {
      const insp = mem.inspections.get(input.inspectionId)!;
      const nextCover = pickNextCoverMediaId(
        Array.from(mem.media.values()).filter((m) => m.inspection_id === input.inspectionId),
        coverItem?.id ?? null,
      );
      mem.inspections.set(input.inspectionId, {
        ...insp,
        cover_media_id: nextCover,
        updated_at: nowIso(),
      });
    } else {
      const insp = mem.inspections.get(input.inspectionId);
      if (insp) {
        mem.inspections.set(input.inspectionId, { ...insp, updated_at: nowIso() });
      }
    }
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("site_inspection_media").delete().eq("id", row.id);
    if (error) throw error;
    if (wasCover) {
      const { data: siblings } = await supabase
        .from("site_inspection_media")
        .select("*")
        .eq("inspection_id", input.inspectionId)
        .order("sort_order", { ascending: true });
      const nextCover = pickNextCoverMediaId((siblings ?? []) as MediaRow[], coverItem?.id ?? null);
      await supabase
        .from("site_inspections")
        .update({ cover_media_id: nextCover, updated_at: nowIso() })
        .eq("id", input.inspectionId);
    } else {
      await supabase
        .from("site_inspections")
        .update({ updated_at: nowIso() })
        .eq("id", input.inspectionId);
    }
  }

  if (storagePath) {
    await deleteSiteInspectionMediaObject(storagePath);
  }

  return getSiteInspection(input.inspectionId);
}

function pickNextCoverMediaId(
  media: MediaRow[],
  coverSnapshotItemId: string | null,
): string | null {
  if (!coverSnapshotItemId) return null;
  const candidates = media
    .filter(
      (m) =>
        m.snapshot_item_id === coverSnapshotItemId &&
        m.media_type === "photo" &&
        m.upload_status === "ready" &&
        m.storage_path,
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return candidates[0]?.id ?? null;
}

/** Test helper: signed URL for a media path without going through get. */
export async function peekMediaSignedUrlForTests(storagePath: string) {
  return createSiteInspectionMediaSignedUrl(storagePath);
}
