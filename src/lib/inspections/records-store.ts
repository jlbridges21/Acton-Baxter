/**
 * Site inspection visit persistence — service-role writes; memory for tests/mock.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
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
  downloadSiteInspectionMediaBytes,
  ensureChromePlayableVideoObject,
  putMemoryMediaBytes,
} from "./media-storage";
import { posterStoragePathForVideo } from "./video-remux";
import { supabaseResumableUploadEndpoint } from "./media-limits";
import {
  type AiProcessingPhase,
  type AiProcessingStatus,
  type CreateSiteInspectionInput,
  SITE_INSPECTION_MEDIA_BUCKET,
  type SiteInspectionDetail,
  type SiteInspectionItemSummary,
  type SiteInspectionMedia,
  type SiteInspectionResponse,
  type SiteInspectionStatus,
  type SiteInspectionSummary,
  type SubQuestionAnswer,
  type TranscriptSegment,
  type TranscriptStatus,
  type UpsertResponseInput,
} from "./record-types";
import {
  listItemSummariesForInspection,
  readAiProgressFromMemory,
  readTranscriptFromMemory,
  resetSiteInspectionAiMemoryForTests,
} from "./ai/store";
import { buildItemSummaryFingerprint, describeSummaryStaleReason } from "./ai/fingerprint";
import { isPrematureEmptySummary } from "./ai/transcript-gate";
import { enqueueSiteInspectionAi } from "./ai/enqueue";

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
  ai_processing_status?: AiProcessingStatus;
  ai_processing_message?: string | null;
  ai_processing_videos_total?: number;
  ai_processing_videos_done?: number;
  ai_processing_summaries_total?: number;
  ai_processing_summaries_done?: number;
  ai_processing_phase?: AiProcessingPhase | null;
  ai_processing_started_at?: string | null;
  ai_processing_finished_at?: string | null;
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
  poster_storage_path: string | null;
  media_type: "photo" | "video";
  sort_order: number;
  upload_status: "pending" | "uploading" | "ready" | "failed";
  upload_progress: number | null;
  mime_type: string | null;
  byte_size: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  transcript_status?: TranscriptStatus | null;
  transcript_text?: string | null;
  transcript_segments?: TranscriptSegment[] | null;
  transcript_error?: string | null;
  transcript_updated_at?: string | null;
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
  resetSiteInspectionAiMemoryForTests();
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

function mapMedia(
  row: MediaRow,
  signedUrl?: string | null,
  posterSignedUrl?: string | null,
): SiteInspectionMedia {
  const memTx = shouldUseMemory() ? readTranscriptFromMemory(row.id) : null;
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
    posterSignedUrl: posterSignedUrl ?? null,
    transcriptStatus: memTx?.transcript_status ?? row.transcript_status ?? null,
    transcriptText: memTx?.transcript_text ?? row.transcript_text ?? null,
    transcriptSegments: memTx?.transcript_segments ?? row.transcript_segments ?? null,
    transcriptError: memTx?.transcript_error ?? row.transcript_error ?? null,
    transcriptUpdatedAt: memTx?.transcript_updated_at ?? row.transcript_updated_at ?? null,
  };
}

function resolvedPosterPath(row: MediaRow): string | null {
  if (row.poster_storage_path) return row.poster_storage_path;
  if (row.media_type === "video" && row.storage_path) {
    return posterStoragePathForVideo(row.storage_path);
  }
  return null;
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
  "id, project_name, address, job_id, assigned_to, source_template_id, status, cover_media_id, total_item_count, completed_item_count, created_by, created_at, updated_at, deleted_at, ai_processing_status, ai_processing_message, ai_processing_videos_total, ai_processing_videos_done, ai_processing_summaries_total, ai_processing_summaries_done, ai_processing_phase, ai_processing_started_at, ai_processing_finished_at";

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
  ai_processing_status?: AiProcessingStatus | null;
  ai_processing_message?: string | null;
  ai_processing_videos_total?: number | null;
  ai_processing_videos_done?: number | null;
  ai_processing_summaries_total?: number | null;
  ai_processing_summaries_done?: number | null;
  ai_processing_phase?: AiProcessingPhase | null;
  ai_processing_started_at?: string | null;
  ai_processing_finished_at?: string | null;
};

function aiFieldsFromRow(row: {
  id: string;
  ai_processing_status?: AiProcessingStatus | null;
  ai_processing_message?: string | null;
  ai_processing_videos_total?: number | null;
  ai_processing_videos_done?: number | null;
  ai_processing_summaries_total?: number | null;
  ai_processing_summaries_done?: number | null;
  ai_processing_phase?: AiProcessingPhase | null;
  ai_processing_started_at?: string | null;
  ai_processing_finished_at?: string | null;
}): Pick<
  SiteInspectionSummary,
  | "aiProcessingStatus"
  | "aiProcessingMessage"
  | "aiProcessingVideosTotal"
  | "aiProcessingVideosDone"
  | "aiProcessingSummariesTotal"
  | "aiProcessingSummariesDone"
  | "aiProcessingPhase"
  | "aiProcessingStartedAt"
  | "aiProcessingFinishedAt"
> {
  const mem = shouldUseMemory() ? readAiProgressFromMemory(row.id) : null;
  return {
    aiProcessingStatus:
      mem?.ai_processing_status ?? row.ai_processing_status ?? ("idle" as AiProcessingStatus),
    aiProcessingMessage: mem?.ai_processing_message ?? row.ai_processing_message ?? null,
    aiProcessingVideosTotal: mem?.ai_processing_videos_total ?? row.ai_processing_videos_total ?? 0,
    aiProcessingVideosDone: mem?.ai_processing_videos_done ?? row.ai_processing_videos_done ?? 0,
    aiProcessingSummariesTotal:
      mem?.ai_processing_summaries_total ?? row.ai_processing_summaries_total ?? 0,
    aiProcessingSummariesDone:
      mem?.ai_processing_summaries_done ?? row.ai_processing_summaries_done ?? 0,
    aiProcessingPhase: mem?.ai_processing_phase ?? row.ai_processing_phase ?? null,
    aiProcessingStartedAt: mem?.ai_processing_started_at ?? row.ai_processing_started_at ?? null,
    aiProcessingFinishedAt: mem?.ai_processing_finished_at ?? row.ai_processing_finished_at ?? null,
  };
}

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
    ...aiFieldsFromRow(row),
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
    ...aiFieldsFromRow(row),
  };
}

function enrichItemSummariesWithStale(
  summaries: SiteInspectionItemSummary[],
  media: SiteInspectionMedia[],
  responses: SiteInspectionResponse[],
): SiteInspectionItemSummary[] {
  return summaries.map((summary) => {
    const notes = responses.find((r) => r.snapshotItemId === summary.snapshotItemId)?.notes ?? "";
    const videos = media.filter(
      (m) =>
        m.snapshotItemId === summary.snapshotItemId &&
        m.mediaType === "video" &&
        m.uploadStatus === "ready",
    );
    const currentFp = buildItemSummaryFingerprint({
      notes,
      videos: videos.map((v) => ({
        mediaId: v.id,
        transcriptStatus: v.transcriptStatus,
        transcriptText: v.transcriptText,
        transcriptSegments: v.transcriptSegments,
      })),
    });
    const premature = isPrematureEmptySummary({
      summaryText: summary.summaryText,
      status: summary.status,
      videos,
    });
    const contentStale =
      summary.status === "complete" &&
      Boolean(summary.summaryText.trim()) &&
      currentFp !== summary.contentFingerprint;
    const isStale = premature || contentStale;
    if (!isStale) {
      return { ...summary, isStale: false, staleReason: null };
    }
    return {
      ...summary,
      isStale: true,
      staleReason: premature
        ? "summary was generated before transcripts were ready"
        : describeSummaryStaleReason({
            previousNotes: summary.sourceNotes,
            currentNotes: notes,
            previousVideoIds: summary.sourceVideoIds,
            currentVideoIds: videos.map((v) => v.id),
          }),
    };
  });
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
    ai_processing_status: "idle",
    ai_processing_message: null,
    ai_processing_videos_total: 0,
    ai_processing_videos_done: 0,
    ai_processing_summaries_total: 0,
    ai_processing_summaries_done: 0,
    ai_processing_phase: null,
    ai_processing_started_at: null,
    ai_processing_finished_at: null,
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
        ai_processing_status: r.ai_processing_status,
        ai_processing_message: r.ai_processing_message,
        ai_processing_videos_total: r.ai_processing_videos_total,
        ai_processing_videos_done: r.ai_processing_videos_done,
        ai_processing_summaries_total: r.ai_processing_summaries_total,
        ai_processing_summaries_done: r.ai_processing_summaries_done,
        ai_processing_phase: r.ai_processing_phase,
        ai_processing_started_at: r.ai_processing_started_at,
        ai_processing_finished_at: r.ai_processing_finished_at,
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

  const paths = media.flatMap((m) => {
    const list = m.storage_path ? [m.storage_path] : [];
    const poster = resolvedPosterPath(m);
    if (poster) list.push(poster);
    return list;
  });
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
  const mappedMedia = media.map((m) => {
    const poster = resolvedPosterPath(m);
    return mapMedia(
      m,
      m.storage_path ? urlMap.get(m.storage_path) : null,
      poster ? (urlMap.get(poster) ?? null) : null,
    );
  });
  const mappedResponses = responses.map(mapResponse);
  const itemSummaries = enrichItemSummariesWithStale(
    await listItemSummariesForInspection(id),
    mappedMedia,
    mappedResponses,
  );

  // Auto-repair premature empty summaries + backfill missing posters (non-blocking).
  scheduleInspectionMaintenance(id, itemSummaries, mappedMedia);

  return {
    ...summary,
    snapshot: row.snapshot_json,
    responses: mappedResponses,
    media: mappedMedia,
    itemSummaries,
  };
}

function scheduleInspectionMaintenance(
  inspectionId: string,
  itemSummaries: SiteInspectionItemSummary[],
  media: SiteInspectionMedia[],
): void {
  const needsSummaryRepair = itemSummaries.some(
    (s) => s.staleReason === "summary was generated before transcripts were ready",
  );
  const needsPoster = media.some(
    (m) =>
      m.mediaType === "video" &&
      m.uploadStatus === "ready" &&
      m.storagePath &&
      !m.posterSignedUrl &&
      !m.localPosterUrl,
  );
  if (!needsSummaryRepair && !needsPoster) return;

  const run = async () => {
    if (needsSummaryRepair) {
      try {
        const { repairPrematureEmptySummariesForInspection } = await import("./ai/run-job");
        const n = await repairPrematureEmptySummariesForInspection(inspectionId);
        if (n > 0) {
          console.info("[site-inspection-ai] repaired premature empty summaries", {
            inspectionId,
            repaired: n,
          });
        }
      } catch (error) {
        console.warn("[site-inspection-ai] repair failed", error);
      }
    }
    if (needsPoster) {
      const { ensureServerVideoPoster } = await import("./ensure-video-poster");
      for (const m of media) {
        if (
          m.mediaType !== "video" ||
          m.uploadStatus !== "ready" ||
          !m.storagePath ||
          m.posterSignedUrl
        ) {
          continue;
        }
        try {
          const result = await ensureServerVideoPoster({
            mediaId: m.id,
            storagePath: m.storagePath,
          });
          if (result.ok && shouldUseMemory()) {
            const mem = getMemory();
            const row = mem.media.get(m.id);
            if (row) {
              mem.media.set(m.id, {
                ...row,
                poster_storage_path: result.posterPath,
                updated_at: nowIso(),
              });
            }
          }
        } catch (error) {
          console.warn("[site-inspection-media] poster backfill failed", {
            mediaId: m.id,
            error,
          });
        }
      }
    }
  };

  if (shouldUseMemory()) {
    void run();
    return;
  }
  after(run);
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

  if (input.status === "complete") {
    let hasVideo = false;
    if (shouldUseMemory()) {
      hasVideo = Array.from(getMemory().media.values()).some(
        (m) =>
          m.inspection_id === input.inspectionId &&
          m.media_type === "video" &&
          m.upload_status === "ready",
      );
    } else {
      const supabase = createServiceClient();
      const { count } = await supabase
        .from("site_inspection_media")
        .select("id", { count: "exact", head: true })
        .eq("inspection_id", input.inspectionId)
        .eq("media_type", "video")
        .eq("upload_status", "ready");
      hasVideo = (count ?? 0) > 0;
    }
    if (hasVideo) {
      await enqueueSiteInspectionAi(input.inspectionId);
    }
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
  const paths = media.flatMap((m) => {
    const list = m.storage_path ? [m.storage_path] : [];
    const poster = resolvedPosterPath(m);
    if (poster) list.push(poster);
    return list;
  });
  const urlMap = await createSiteInspectionMediaSignedUrlMap(paths, expiresInSeconds);
  const urls: Record<string, string> = {};
  for (const m of media) {
    if (m.storage_path && urlMap.has(m.storage_path)) {
      urls[m.id] = urlMap.get(m.storage_path)!;
      if (m.client_media_id) urls[m.client_media_id] = urlMap.get(m.storage_path)!;
    }
    const poster = resolvedPosterPath(m);
    if (poster && urlMap.has(poster)) {
      urls[`poster:${m.id}`] = urlMap.get(poster)!;
      if (m.client_media_id) urls[`poster:${m.client_media_id}`] = urlMap.get(poster)!;
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
 * Mint direct-to-storage upload credentials. Does NOT create a media row —
 * optimistic UI stays device-local until bytes land and complete() runs.
 * Photos use short-lived signed upload URLs (minted at upload time).
 * Videos use resumable TUS against the storage hostname.
 * Video posters are generated server-side (ffmpeg) on complete — not client-uploaded.
 */
export async function prepareSiteInspectionMedia(input: {
  inspectionId: string;
  snapshotItemId: string;
  clientMediaId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  byteSize: number;
  actorId: string;
  /** @deprecated Ignored — client poster uploads retired. */
  includePosterUpload?: boolean;
}): Promise<{
  upload:
    | {
        mode: "signed";
        path: string;
        token: string;
        signedUrl: string;
      }
    | { mode: "tus"; path: string; bucket: string; tusEndpoint: string }
    | { mode: "memory"; path: string };
}> {
  const inspection = await loadInspectionRow(input.inspectionId);
  const item = assertItemInSnapshot(inspection.snapshot_json, input.snapshotItemId);
  if (!item.allowsMedia) throw new ValidationError("This item does not allow media");
  if (!input.clientMediaId.trim()) throw new ValidationError("clientMediaId is required");
  void input.includePosterUpload;

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

  if (shouldUseMemory()) {
    return {
      upload: {
        mode: "memory",
        path: storagePath,
      },
    };
  }

  // Large / any video → resumable TUS (survives cell drops). Photos stay on signed URL.
  if (input.mediaType === "video") {
    const tusEndpoint = supabaseResumableUploadEndpoint(getEnv().NEXT_PUBLIC_SUPABASE_URL);
    return {
      upload: {
        mode: "tus",
        path: storagePath,
        bucket: SITE_INSPECTION_MEDIA_BUCKET,
        tusEndpoint,
      },
    };
  }

  const signed = await createSignedUploadForPath(storagePath);
  return {
    upload: {
      mode: "signed",
      path: storagePath,
      token: signed.token,
      signedUrl: signed.signedUrl,
    },
  };
}

export async function completeSiteInspectionMedia(input: {
  inspectionId: string;
  clientMediaId: string;
  snapshotItemId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  storagePath: string;
  byteSize: number;
  actorId: string;
  posterStoragePath?: string | null;
}): Promise<SiteInspectionDetail> {
  const inspection = await loadInspectionRow(input.inspectionId);
  assertItemInSnapshot(inspection.snapshot_json, input.snapshotItemId);
  if (!input.clientMediaId.trim()) throw new ValidationError("clientMediaId is required");
  if (!input.storagePath.trim()) throw new ValidationError("storagePath is required");

  let storagePath = input.storagePath;
  let mimeType = input.mimeType;
  let byteSize = input.byteSize;
  const posterStoragePath =
    input.posterStoragePath?.trim() ||
    (input.mediaType === "video" ? posterStoragePathForVideo(storagePath) : null);

  // Remux QuickTime → MP4 so Chrome (and other non-Safari browsers) can play H.264.
  if (input.mediaType === "video" && !shouldUseMemory()) {
    const playable = await ensureChromePlayableVideoObject({
      storagePath,
      mimeType,
    });
    storagePath = playable.storagePath;
    mimeType = playable.mimeType;
    byteSize = playable.byteSize || byteSize;
  }

  const now = nowIso();
  let mediaId: string = randomUUID();
  let sortOrder = 0;
  const mediaType = input.mediaType;
  const snapshotItemId = input.snapshotItemId;

  if (shouldUseMemory()) {
    const mem = getMemory();
    const existing = Array.from(mem.media.values()).find(
      (m) => m.inspection_id === input.inspectionId && m.client_media_id === input.clientMediaId,
    );
    if (existing) {
      mediaId = existing.id;
      sortOrder = existing.sort_order;
      mem.media.set(existing.id, {
        ...existing,
        snapshot_item_id: snapshotItemId,
        storage_path: storagePath,
        poster_storage_path: posterStoragePath,
        media_type: mediaType,
        mime_type: mimeType,
        byte_size: byteSize,
        upload_status: "ready",
        upload_progress: 1,
        updated_at: now,
      });
    } else {
      const siblings = Array.from(mem.media.values()).filter(
        (m) => m.inspection_id === input.inspectionId && m.snapshot_item_id === snapshotItemId,
      );
      sortOrder = siblings.length;
      mem.media.set(mediaId, {
        id: mediaId,
        inspection_id: input.inspectionId,
        snapshot_item_id: snapshotItemId,
        client_media_id: input.clientMediaId,
        storage_path: storagePath,
        poster_storage_path: posterStoragePath,
        media_type: mediaType,
        sort_order: sortOrder,
        upload_status: "ready",
        upload_progress: 1,
        mime_type: mimeType,
        byte_size: byteSize,
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

    const baseFields: Record<string, unknown> = {
      snapshot_item_id: snapshotItemId,
      storage_path: storagePath,
      media_type: mediaType,
      mime_type: mimeType,
      byte_size: byteSize,
      upload_status: "ready",
      upload_progress: 1,
    };
    // poster_storage_path is optional until migration 050 is applied — try, ignore unknown column.
    if (posterStoragePath) baseFields.poster_storage_path = posterStoragePath;

    if (existing) {
      mediaId = existing.id as string;
      sortOrder = existing.sort_order as number;
      const { error } = await supabase
        .from("site_inspection_media")
        .update(baseFields)
        .eq("id", mediaId);
      if (error && /poster_storage_path/i.test(error.message)) {
        delete baseFields.poster_storage_path;
        const retry = await supabase
          .from("site_inspection_media")
          .update(baseFields)
          .eq("id", mediaId);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }
    } else {
      const { count } = await supabase
        .from("site_inspection_media")
        .select("id", { count: "exact", head: true })
        .eq("inspection_id", input.inspectionId)
        .eq("snapshot_item_id", snapshotItemId);
      sortOrder = count ?? 0;
      const insertRow: Record<string, unknown> = {
        id: mediaId,
        inspection_id: input.inspectionId,
        client_media_id: input.clientMediaId,
        sort_order: sortOrder,
        created_by: input.actorId,
        ...baseFields,
      };
      const { error } = await supabase.from("site_inspection_media").insert(insertRow);
      if (error && /poster_storage_path/i.test(error.message)) {
        delete insertRow.poster_storage_path;
        const retry = await supabase.from("site_inspection_media").insert(insertRow);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }
    }
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

  // Server-side poster: never block/fail the upload if extraction fails.
  if (mediaType === "video" && storagePath) {
    try {
      const { ensureServerVideoPoster } = await import("./ensure-video-poster");
      const result = await ensureServerVideoPoster({
        mediaId,
        storagePath,
        posterStoragePath,
      });
      if (result.ok && shouldUseMemory()) {
        const mem = getMemory();
        const row = mem.media.get(mediaId);
        if (row) {
          mem.media.set(mediaId, {
            ...row,
            poster_storage_path: result.posterPath,
            updated_at: nowIso(),
          });
        }
      } else if (!result.ok) {
        console.warn("[site-inspection-media] server poster extract failed", {
          mediaId,
          message: result.message,
        });
      }
    } catch (error) {
      console.warn("[site-inspection-media] server poster extract threw", error);
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
  return completeSiteInspectionMedia({
    inspectionId: input.inspectionId,
    clientMediaId,
    snapshotItemId: input.snapshotItemId,
    mediaType: "photo",
    mimeType: input.mimeType,
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
  const posterPath =
    row.poster_storage_path ||
    (row.media_type === "video" && row.storage_path
      ? posterStoragePathForVideo(row.storage_path)
      : null);
  if (posterPath) {
    await deleteSiteInspectionMediaObject(posterPath);
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

/**
 * Persist a 90° counter-clockwise rotation by re-encoding the stored object.
 * Downloads and zip exports pick up the new bytes automatically.
 */
export async function rotateSiteInspectionMedia(input: {
  inspectionId: string;
  mediaId: string;
  actorId: string;
  actorRole?: string | null;
}): Promise<SiteInspectionDetail> {
  const inspection = await loadInspectionRow(input.inspectionId);

  let row: MediaRow | null = null;
  if (shouldUseMemory()) {
    const mem = getMemory();
    row =
      Array.from(mem.media.values()).find(
        (m) =>
          m.inspection_id === input.inspectionId &&
          (m.id === input.mediaId || m.client_media_id === input.mediaId),
      ) ?? null;
  } else {
    const supabase = createServiceClient();
    const { data: byId } = await supabase
      .from("site_inspection_media")
      .select("*")
      .eq("id", input.mediaId)
      .eq("inspection_id", input.inspectionId)
      .maybeSingle();
    if (byId) {
      row = byId as MediaRow;
    } else {
      const { data: byClient } = await supabase
        .from("site_inspection_media")
        .select("*")
        .eq("client_media_id", input.mediaId)
        .eq("inspection_id", input.inspectionId)
        .maybeSingle();
      row = (byClient as MediaRow | null) ?? null;
    }
  }

  if (!row) throw new NotFoundError("Media not found");
  if (row.media_type !== "photo") {
    throw new ValidationError("Only photos can be rotated");
  }
  if (row.upload_status !== "ready" || !row.storage_path) {
    throw new ValidationError("Wait for the photo to finish uploading before rotating");
  }

  const allowed =
    isAdminRole(input.actorRole) ||
    row.created_by === input.actorId ||
    (!row.created_by && inspection.created_by === input.actorId);
  if (!allowed) {
    throw new AuthorizationError("Only the uploader or an admin can rotate this media");
  }

  const downloaded = await downloadSiteInspectionMediaBytes(row.storage_path);
  if (!downloaded) throw new ValidationError("Could not load the photo to rotate");

  let rotated: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    rotated = await sharp(downloaded.bytes).rotate(-90).jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    console.error("[site-inspection-media] rotate failed", error);
    throw new ValidationError("Could not rotate this photo");
  }

  if (shouldUseMemory()) {
    putMemoryMediaBytes({
      storagePath: row.storage_path,
      bytes: rotated,
      mimeType: "image/jpeg",
      uploadedBy: input.actorId,
    });
    const mem = getMemory();
    mem.media.set(row.id, {
      ...row,
      mime_type: "image/jpeg",
      byte_size: rotated.byteLength,
      updated_at: nowIso(),
    });
  } else {
    const supabase = createServiceClient();
    const { error: uploadError } = await supabase.storage
      .from(SITE_INSPECTION_MEDIA_BUCKET)
      .upload(row.storage_path, rotated, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) {
      throw new ValidationError("Could not save the rotated photo");
    }
    await supabase
      .from("site_inspection_media")
      .update({
        mime_type: "image/jpeg",
        byte_size: rotated.byteLength,
        updated_at: nowIso(),
      })
      .eq("id", row.id);
  }

  return getSiteInspection(input.inspectionId);
}

/** Delete abandoned pending/uploading rows that never received bytes. */
export async function purgeOrphanPendingMediaRows(): Promise<number> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    let removed = 0;
    for (const [id, row] of mem.media) {
      if (row.upload_status === "pending" || row.upload_status === "uploading") {
        mem.media.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("site_inspection_media")
    .delete()
    .in("upload_status", ["pending", "uploading"])
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Test helper: signed URL for a media path without going through get. */
export async function peekMediaSignedUrlForTests(storagePath: string) {
  return createSiteInspectionMediaSignedUrl(storagePath);
}
