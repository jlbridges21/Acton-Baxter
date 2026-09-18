/**
 * Persist an item draft via existing template actions (no schema change).
 */

import type { InspectionTemplateDetail } from "@/lib/inspections/types";
import type { ItemDraft } from "@/components/inspections/template-item-modal";

type PostAction = (body: Record<string, unknown>) => Promise<InspectionTemplateDetail>;

function allItems(template: InspectionTemplateDetail) {
  return [...template.standaloneItems, ...template.sections.flatMap((s) => s.items)];
}

function findItem(template: InspectionTemplateDetail, itemId: string) {
  return allItems(template).find((i) => i.id === itemId);
}

async function syncOptions(
  post: PostAction,
  template: InspectionTemplateDetail,
  subQuestionId: string,
  desired: { key: string; label: string }[],
): Promise<InspectionTemplateDetail> {
  let latest = template;
  const live =
    allItems(latest)
      .flatMap((i) => i.subQuestions)
      .find((s) => s.id === subQuestionId)?.options ?? [];

  for (const opt of live) {
    if (!desired.some((d) => d.key === opt.id)) {
      latest = await post({ action: "delete_option", optionId: opt.id });
    }
  }

  const orderedIds: string[] = [];
  for (const d of desired) {
    const currentLive =
      allItems(latest)
        .flatMap((i) => i.subQuestions)
        .find((s) => s.id === subQuestionId)?.options ?? [];

    if (currentLive.some((o) => o.id === d.key)) {
      const existing = currentLive.find((o) => o.id === d.key)!;
      if (existing.label !== d.label) {
        latest = await post({
          action: "update_option",
          optionId: d.key,
          label: d.label,
        });
      }
      orderedIds.push(d.key);
    } else {
      const before = new Set(currentLive.map((o) => o.id));
      latest = await post({
        action: "add_option",
        subQuestionId,
        label: d.label,
      });
      const after =
        allItems(latest)
          .flatMap((i) => i.subQuestions)
          .find((s) => s.id === subQuestionId)?.options ?? [];
      const created = after.find((o) => !before.has(o.id));
      if (created) orderedIds.push(created.id);
    }
  }

  if (orderedIds.length > 1) {
    latest = await post({
      action: "reorder_options",
      subQuestionId,
      orderedIds,
    });
  }

  return latest;
}

export async function persistItemDraft(
  post: PostAction,
  template: InspectionTemplateDetail,
  draft: ItemDraft,
): Promise<InspectionTemplateDetail> {
  let latest = template;
  let itemId = draft.serverId;

  if (!itemId) {
    const before = new Set(allItems(latest).map((i) => i.id));
    latest = await post({
      action: "add_item",
      templateId: template.id,
      sectionId: draft.sectionId,
      title: draft.title,
      guideNotes: draft.guideNotes,
      isCoverPhotoSource: draft.isCoverPhotoSource,
      allowsMedia: draft.allowsMedia,
      allowsNotes: draft.allowsNotes,
    });
    const created = allItems(latest).find((i) => !before.has(i.id));
    if (!created) throw new Error("Could not find created item");
    itemId = created.id;
  } else {
    latest = await post({
      action: "update_item",
      itemId,
      title: draft.title,
      guideNotes: draft.guideNotes,
      isCoverPhotoSource: draft.isCoverPhotoSource,
      allowsMedia: draft.allowsMedia,
      allowsNotes: draft.allowsNotes,
    });
  }

  const current = findItem(latest, itemId);
  if (!current) throw new Error("Item missing after save");

  const keepIds = new Set(
    draft.subQuestions.map((s) => s.serverId).filter((id): id is string => Boolean(id)),
  );
  for (const sq of current.subQuestions) {
    if (!keepIds.has(sq.id)) {
      latest = await post({ action: "delete_sub_question", subQuestionId: sq.id });
    }
  }

  const orderedSqIds: string[] = [];
  for (const draftSq of draft.subQuestions) {
    if (draftSq.serverId) {
      latest = await post({
        action: "update_sub_question",
        subQuestionId: draftSq.serverId,
        prompt: draftSq.prompt,
        questionType: draftSq.questionType,
      });
      orderedSqIds.push(draftSq.serverId);
      latest = await syncOptions(post, latest, draftSq.serverId, draftSq.options);
    } else {
      const before = new Set((findItem(latest, itemId)?.subQuestions ?? []).map((s) => s.id));
      latest = await post({
        action: "add_sub_question",
        itemId,
        prompt: draftSq.prompt,
        questionType: draftSq.questionType,
        options: draftSq.options.map((o) => ({ label: o.label })),
      });
      const created = (findItem(latest, itemId)?.subQuestions ?? []).find((s) => !before.has(s.id));
      if (created) orderedSqIds.push(created.id);
    }
  }

  if (orderedSqIds.length > 0) {
    latest = await post({
      action: "reorder_sub_questions",
      itemId,
      orderedIds: orderedSqIds,
    });
  }

  return latest;
}
