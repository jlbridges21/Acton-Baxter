/**
 * Persist transcript / summary / AI progress for site inspections.
 * Supports the in-memory test store used by ENABLE_MOCK_RESEARCH.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import type {
  AiProcessingPhase,
  AiProcessingStatus,
  ItemSummaryStatus,
  SiteInspectionItemSummary,
  TranscriptSegment,
  TranscriptStatus,
} from "../record-types";

export type AiProgressPatch = {
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

type SummaryRow = {
  id: string;
  inspection_id: string;
  snapshot_item_id: string;
  summary_text: string;
  content_fingerprint: string;
  source_notes: string;
  source_video_ids: string[] | unknown;
  status: ItemSummaryStatus;
  error: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseVideoIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}

type MemoryAiState = {
  summaries: Map<string, SummaryRow>;
  /** inspectionId → progress fields */
  progress: Map<string, AiProgressPatch>;
  /** mediaId → transcript fields */
  transcripts: Map<
    string,
    {
      transcript_status: TranscriptStatus | null;
      transcript_text: string | null;
      transcript_segments: TranscriptSegment[] | null;
      transcript_error: string | null;
      transcript_updated_at: string | null;
    }
  >;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSiteInspectionAi?: MemoryAiState;
};

function getAiMemory(): MemoryAiState {
  if (!globalMemory.__baxterSiteInspectionAi) {
    globalMemory.__baxterSiteInspectionAi = {
      summaries: new Map(),
      progress: new Map(),
      transcripts: new Map(),
    };
  }
  return globalMemory.__baxterSiteInspectionAi;
}

export function resetSiteInspectionAiMemoryForTests() {
  globalMemory.__baxterSiteInspectionAi = {
    summaries: new Map(),
    progress: new Map(),
    transcripts: new Map(),
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

export function mapSummaryRow(row: SummaryRow): SiteInspectionItemSummary {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    snapshotItemId: row.snapshot_item_id,
    summaryText: row.summary_text,
    contentFingerprint: row.content_fingerprint,
    sourceNotes: row.source_notes ?? "",
    sourceVideoIds: parseVideoIds(row.source_video_ids),
    status: row.status,
    error: row.error,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function patchInspectionAiProgress(
  inspectionId: string,
  patch: AiProgressPatch,
): Promise<void> {
  if (shouldUseMemory()) {
    const mem = getAiMemory();
    mem.progress.set(inspectionId, { ...(mem.progress.get(inspectionId) ?? {}), ...patch });
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("site_inspections").update(patch).eq("id", inspectionId);
  if (error) throw error;
}

/** Test helper used by enqueue before run-job circular import settles. */
export function patchInspectionAiProgressForTests(inspectionId: string, patch: AiProgressPatch) {
  const mem = getAiMemory();
  mem.progress.set(inspectionId, { ...(mem.progress.get(inspectionId) ?? {}), ...patch });
}

export function readAiProgressFromMemory(inspectionId: string): AiProgressPatch | null {
  return getAiMemory().progress.get(inspectionId) ?? null;
}

export function readTranscriptFromMemory(mediaId: string) {
  return getAiMemory().transcripts.get(mediaId) ?? null;
}

export async function updateMediaTranscript(
  mediaId: string,
  patch: {
    transcript_status: TranscriptStatus;
    transcript_text?: string | null;
    transcript_segments?: TranscriptSegment[] | null;
    transcript_error?: string | null;
  },
): Promise<void> {
  const updatedAt = nowIso();
  if (shouldUseMemory()) {
    const prev = getAiMemory().transcripts.get(mediaId);
    getAiMemory().transcripts.set(mediaId, {
      transcript_status: patch.transcript_status,
      transcript_text:
        patch.transcript_text !== undefined
          ? patch.transcript_text
          : (prev?.transcript_text ?? null),
      transcript_segments:
        patch.transcript_segments !== undefined
          ? patch.transcript_segments
          : (prev?.transcript_segments ?? null),
      transcript_error:
        patch.transcript_error !== undefined
          ? patch.transcript_error
          : (prev?.transcript_error ?? null),
      transcript_updated_at: updatedAt,
    });
    return;
  }
  const supabase = createServiceClient();
  const row: Record<string, unknown> = {
    transcript_status: patch.transcript_status,
    transcript_updated_at: updatedAt,
  };
  if (patch.transcript_text !== undefined) row.transcript_text = patch.transcript_text;
  if (patch.transcript_segments !== undefined) {
    row.transcript_segments = patch.transcript_segments;
  }
  if (patch.transcript_error !== undefined) row.transcript_error = patch.transcript_error;
  const { error } = await supabase.from("site_inspection_media").update(row).eq("id", mediaId);
  if (error) throw error;
}

export async function upsertItemSummary(input: {
  inspectionId: string;
  snapshotItemId: string;
  summaryText: string;
  contentFingerprint: string;
  sourceNotes?: string;
  sourceVideoIds?: string[];
  status: ItemSummaryStatus;
  error?: string | null;
}): Promise<SiteInspectionItemSummary> {
  const timestamp = nowIso();
  const sourceNotes = input.sourceNotes ?? "";
  const sourceVideoIds = input.sourceVideoIds ?? [];
  if (shouldUseMemory()) {
    const mem = getAiMemory();
    const key = `${input.inspectionId}:${input.snapshotItemId}`;
    const existing = mem.summaries.get(key);
    const row: SummaryRow = {
      id: existing?.id ?? randomUUID(),
      inspection_id: input.inspectionId,
      snapshot_item_id: input.snapshotItemId,
      summary_text: input.summaryText,
      content_fingerprint: input.contentFingerprint,
      source_notes: sourceNotes,
      source_video_ids: sourceVideoIds,
      status: input.status,
      error: input.error ?? null,
      generated_at: input.status === "complete" ? timestamp : (existing?.generated_at ?? null),
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    };
    mem.summaries.set(key, row);
    return mapSummaryRow(row);
  }

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("site_inspection_item_summaries")
    .select("id")
    .eq("inspection_id", input.inspectionId)
    .eq("snapshot_item_id", input.snapshotItemId)
    .maybeSingle();

  const payload = {
    summary_text: input.summaryText,
    content_fingerprint: input.contentFingerprint,
    source_notes: sourceNotes,
    source_video_ids: sourceVideoIds,
    status: input.status,
    error: input.error ?? null,
    generated_at: input.status === "complete" ? timestamp : null,
    updated_at: timestamp,
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("site_inspection_item_summaries")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return mapSummaryRow(data as SummaryRow);
  }

  const { data, error } = await supabase
    .from("site_inspection_item_summaries")
    .insert({
      id: randomUUID(),
      inspection_id: input.inspectionId,
      snapshot_item_id: input.snapshotItemId,
      ...payload,
      created_at: timestamp,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapSummaryRow(data as SummaryRow);
}

export async function listItemSummariesForInspection(
  inspectionId: string,
): Promise<SiteInspectionItemSummary[]> {
  if (shouldUseMemory()) {
    return Array.from(getAiMemory().summaries.values())
      .filter((r) => r.inspection_id === inspectionId)
      .map(mapSummaryRow);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("site_inspection_item_summaries")
    .select("*")
    .eq("inspection_id", inspectionId);
  if (error) {
    // Table may not exist yet in older envs — treat as empty.
    if (
      String(error.message ?? "")
        .toLowerCase()
        .includes("does not exist")
    )
      return [];
    throw error;
  }
  return ((data ?? []) as SummaryRow[]).map(mapSummaryRow);
}

export async function getItemSummary(
  inspectionId: string,
  snapshotItemId: string,
): Promise<SiteInspectionItemSummary | null> {
  const all = await listItemSummariesForInspection(inspectionId);
  return all.find((s) => s.snapshotItemId === snapshotItemId) ?? null;
}
