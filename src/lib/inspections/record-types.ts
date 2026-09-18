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
};

export type SiteInspectionDetail = SiteInspectionSummary & {
  snapshot: InspectionSnapshot;
  responses: SiteInspectionResponse[];
  media: SiteInspectionMedia[];
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
