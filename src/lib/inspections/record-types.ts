/**
 * Site inspection visit records (separate from live templates).
 */

import type { InspectionSubQuestionType } from "./types";
import type { InspectionSnapshot } from "./snapshot";

export const SITE_INSPECTION_STATUSES = ["pending", "complete"] as const;
export type SiteInspectionStatus = (typeof SITE_INSPECTION_STATUSES)[number];

export const SITE_INSPECTION_MEDIA_TYPES = ["photo", "video"] as const;
export type SiteInspectionMediaType = (typeof SITE_INSPECTION_MEDIA_TYPES)[number];

export const SITE_INSPECTION_UPLOAD_STATUSES = ["pending", "uploading", "ready", "failed"] as const;
export type SiteInspectionUploadStatus = (typeof SITE_INSPECTION_UPLOAD_STATUSES)[number];

export const SITE_INSPECTION_MEDIA_BUCKET = "site-inspection-media";

export const TRANSCRIPT_STATUSES = [
  "pending",
  "processing",
  "complete",
  "failed",
  "no_speech_detected",
] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const ITEM_SUMMARY_STATUSES = ["pending", "processing", "complete", "failed"] as const;
export type ItemSummaryStatus = (typeof ITEM_SUMMARY_STATUSES)[number];

export const AI_PROCESSING_STATUSES = [
  "idle",
  "queued",
  "processing",
  "complete",
  "failed",
] as const;
export type AiProcessingStatus = (typeof AI_PROCESSING_STATUSES)[number];

export const AI_PROCESSING_PHASES = ["transcribing", "summarizing", "complete", "failed"] as const;
export type AiProcessingPhase = (typeof AI_PROCESSING_PHASES)[number];

export type TranscriptSegment = {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
};

export type SiteInspectionItemSummary = {
  id: string;
  inspectionId: string;
  snapshotItemId: string;
  summaryText: string;
  contentFingerprint: string;
  /** Notes captured when this summary was generated (for stale-reason copy). */
  sourceNotes: string;
  /** Video media ids captured when this summary was generated. */
  sourceVideoIds: string[];
  status: ItemSummaryStatus;
  error: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Server-computed: true when current notes/videos/transcripts differ from fingerprint.
   * When false/undefined, the regenerate control must not render.
   */
  isStale?: boolean;
  /** Short reason shown next to regenerate when stale. */
  staleReason?: string | null;
};

export type SubQuestionAnswerValue = string | string[] | null;

export type SubQuestionAnswer = {
  type: InspectionSubQuestionType;
  value: SubQuestionAnswerValue;
};

export type SiteInspectionResponse = {
  id: string;
  inspectionId: string;
  snapshotItemId: string;
  isComplete: boolean;
  notes: string;
  answers: Record<string, SubQuestionAnswer>;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SiteInspectionMedia = {
  id: string;
  inspectionId: string;
  snapshotItemId: string;
  /** Client-generated id for optimistic reconciliation. */
  clientMediaId: string | null;
  storagePath: string | null;
  mediaType: SiteInspectionMediaType;
  sortOrder: number;
  uploadStatus: SiteInspectionUploadStatus;
  uploadProgress: number | null;
  mimeType: string | null;
  byteSize: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Short-lived display URL when requested. */
  signedUrl?: string | null;
  /** Short-lived poster URL for videos (first-frame JPEG). */
  posterSignedUrl?: string | null;
  /** Local object URL for optimistic thumbnails (client-only). */
  localPreviewUrl?: string | null;
  /** Local poster preview while the queue is uploading (client-only). */
  localPosterUrl?: string | null;
  /** Transcription lifecycle — null for photos. */
  transcriptStatus?: TranscriptStatus | null;
  transcriptText?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  transcriptError?: string | null;
  transcriptUpdatedAt?: string | null;
};

export type SiteInspectionSummary = {
  id: string;
  projectName: string;
  address: string;
  jobId: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  sourceTemplateId: string | null;
  status: SiteInspectionStatus;
  coverMediaId: string | null;
  coverSignedUrl: string | null;
  totalItemCount: number;
  completedItemCount: number;
  /** Media still queued/uploading/failed — shown on cards. */
  pendingMediaCount: number;
  failedMediaCount: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Background transcription/summary job after Complete. */
  aiProcessingStatus: AiProcessingStatus;
  aiProcessingMessage: string | null;
  aiProcessingVideosTotal: number;
  aiProcessingVideosDone: number;
  aiProcessingSummariesTotal: number;
  aiProcessingSummariesDone: number;
  aiProcessingPhase: AiProcessingPhase | null;
  aiProcessingStartedAt: string | null;
  aiProcessingFinishedAt: string | null;
};

export type SiteInspectionDetail = SiteInspectionSummary & {
  snapshot: InspectionSnapshot;
  responses: SiteInspectionResponse[];
  media: SiteInspectionMedia[];
  itemSummaries: SiteInspectionItemSummary[];
};

export type CreateSiteInspectionInput = {
  projectName: string;
  address: string;
  jobId?: string | null;
  templateId: string;
  assignedTo?: string | null;
  createdBy: string;
};

export type UpsertResponseInput = {
  inspectionId: string;
  snapshotItemId: string;
  isComplete?: boolean;
  notes?: string;
  answers?: Record<string, SubQuestionAnswer>;
  actorId: string;
};
