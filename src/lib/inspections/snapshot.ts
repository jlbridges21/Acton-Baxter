/**
 * Frozen checklist structure copied into each site inspection at create time.
 * Live template edits must never mutate these shapes.
 */

import { randomUUID } from "node:crypto";
import type { InspectionSubQuestionType, InspectionTemplateDetail } from "./types";

export type SnapshotOption = {
  id: string;
  label: string;
  sortOrder: number;
};

export type SnapshotSubQuestion = {
  id: string;
  prompt: string;
  questionType: InspectionSubQuestionType;
  sortOrder: number;
  options: SnapshotOption[];
};

export type SnapshotItem = {
  id: string;
  /** Provenance only — may be deleted from the live template later. */
  sourceTemplateItemId: string;
  title: string;
  guideNotes: string;
  allowsMedia: boolean;
  allowsNotes: boolean;
  isCoverPhotoSource: boolean;
  sortOrder: number;
  subQuestions: SnapshotSubQuestion[];
};

export type SnapshotSection = {
  id: string;
  sourceTemplateSectionId: string;
  title: string;
  sortOrder: number;
  items: SnapshotItem[];
};

export type InspectionSnapshot = {
  version: 1;
  sourceTemplateId: string;
  sourceTemplateName: string;
  snapshottedAt: string;
  standaloneItems: SnapshotItem[];
  sections: SnapshotSection[];
};

function snapshotItem(item: InspectionTemplateDetail["standaloneItems"][number]): SnapshotItem {
  return {
    id: randomUUID(),
    sourceTemplateItemId: item.id,
    title: item.title,
    guideNotes: item.guideNotes,
    allowsMedia: item.allowsMedia,
    allowsNotes: item.allowsNotes,
    isCoverPhotoSource: item.isCoverPhotoSource,
    sortOrder: item.sortOrder,
    subQuestions: item.subQuestions
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sq) => ({
        id: randomUUID(),
        prompt: sq.prompt,
        questionType: sq.questionType,
        sortOrder: sq.sortOrder,
        options: sq.options
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((opt) => ({
            id: randomUUID(),
            label: opt.label,
            sortOrder: opt.sortOrder,
          })),
      })),
  };
}

/** Deep-copy a live template into an inspection-local snapshot with fresh ids. */
export function buildInspectionSnapshot(
  template: InspectionTemplateDetail,
  snapshottedAt = new Date().toISOString(),
): InspectionSnapshot {
  return {
    version: 1,
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    snapshottedAt,
    standaloneItems: template.standaloneItems
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(snapshotItem),
    sections: template.sections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => ({
        id: randomUUID(),
        sourceTemplateSectionId: section.id,
        title: section.title,
        sortOrder: section.sortOrder,
        items: section.items
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(snapshotItem),
      })),
  };
}

export function listSnapshotItems(snapshot: InspectionSnapshot): SnapshotItem[] {
  return [
    ...snapshot.standaloneItems.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    ...snapshot.sections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((section) => section.items.slice().sort((a, b) => a.sortOrder - b.sortOrder)),
  ];
}

export function countSnapshotItems(snapshot: InspectionSnapshot): number {
  return listSnapshotItems(snapshot).length;
}

export function findCoverPhotoItem(snapshot: InspectionSnapshot): SnapshotItem | null {
  return listSnapshotItems(snapshot).find((item) => item.isCoverPhotoSource) ?? null;
}
