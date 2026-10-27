/** Shapes returned by /api/reports/* (browser side). */

import type { ReportPermission } from "@/lib/reports/repo-types";
import type { ReportSpec } from "@/lib/reports/spec";

export type ReportSummary = {
  id: string;
  title: string;
  description: string;
  ownerId: string | null;
  isMine: boolean;
  visibility: "private" | "shared" | "company";
  isTemplate: boolean;
  templateKey: string | null;
  status: "active" | "archived";
  pinned: boolean;
  version: number;
  widgetCount: number;
  sources: string[];
  createdByDexter: boolean;
  updatedAt: string;
  viewedAt: string | null;
  shareCount: number;
  permission: ReportPermission;
  /** Groups (visible to this viewer) the report is filed in; empty = ungrouped. */
  groupIds: string[];
};

export type ReportsAccessView = {
  canChat: boolean;
  canManage: boolean;
  isAdmin: boolean;
  categories: string[];
};

export type ReportDetail = {
  id: string;
  title: string;
  description: string;
  ownerId: string | null;
  isMine: boolean;
  visibility: "private" | "shared" | "company";
  isTemplate: boolean;
  status: "active" | "archived";
  pinned: boolean;
  version: number;
  spec: ReportSpec;
  updatedAt: string;
  createdByDexter: boolean;
};

export type FieldOption = {
  key: string;
  label: string;
  type: string;
  multi: boolean;
  description: string | null;
  origin: string;
};
export type FieldsResponse = Record<
  "jobs" | "catalog_models" | "cost_items" | "commissions",
  { business: FieldOption[]; all: FieldOption[] }
>;

export type ChatArtifact = {
  type: "report";
  id: string;
  title: string;
  url: string;
  version: number;
};
export type ChatMessage = {
  id: string;
  role: "user" | "dexter";
  content: string;
  createdAt: string;
  artifacts: ChatArtifact[];
  outcome: string | null;
  failed: boolean;
  attachments?: Array<{ id: string; filename: string; kind: string; status: string }>;
};
