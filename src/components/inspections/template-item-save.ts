/**
 * Persist an item draft as a single save_item request.
 */

import type { InspectionTemplateDetail } from "@/lib/inspections/types";
import type { ItemDraft } from "@/components/inspections/template-item-modal";

type PostAction = (body: Record<string, unknown>) => Promise<InspectionTemplateDetail>;

export async function persistItemDraft(
  post: PostAction,
  template: InspectionTemplateDetail,
  draft: ItemDraft,
): Promise<InspectionTemplateDetail> {
  return post({
    action: "save_item",
    templateId: template.id,
    itemId: draft.serverId,
    sectionId: draft.sectionId,
    title: draft.title,
    guideNotes: draft.guideNotes,
    isCoverPhotoSource: draft.isCoverPhotoSource,
    allowsMedia: draft.allowsMedia,
    allowsNotes: draft.allowsNotes,
    subQuestions: draft.subQuestions.map((sq) => ({
      id: sq.serverId,
      prompt: sq.prompt,
      questionType: sq.questionType,
      options: sq.options.map((o) => ({
        // Known server option ids update in place; unknown keys create new rows.
        id: o.key,
        label: o.label,
      })),
    })),
  });
}
