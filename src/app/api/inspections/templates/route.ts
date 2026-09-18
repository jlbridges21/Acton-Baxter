import { requireActiveUser, requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  addItem,
  addOption,
  addSection,
  addSubQuestion,
  archiveTemplate,
  createEmptyTemplate,
  deleteItem,
  deleteOption,
  deleteSection,
  deleteSubQuestion,
  duplicateTemplate,
  listTemplates,
  moveItem,
  permanentlyDeleteTemplate,
  reorderItems,
  reorderOptions,
  reorderSections,
  reorderSubQuestions,
  templateActionSchema,
  unarchiveTemplate,
  updateItem,
  updateOption,
  updateSection,
  updateSubQuestion,
  updateTemplateMeta,
} from "@/lib/inspections";

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    const templates = await listTemplates({ includeArchived });
    return jsonOk({ templates });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/templates");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const parsed = templateActionSchema.parse(await request.json());
    const actorId = user.id;

    switch (parsed.action) {
      case "create": {
        const template = await createEmptyTemplate({
          name: parsed.name,
          description: parsed.description,
          actorId,
        });
        return jsonOk({ template });
      }
      case "duplicate": {
        const template = await duplicateTemplate(parsed.templateId, actorId);
        return jsonOk({ template });
      }
      case "archive": {
        const template = await archiveTemplate(parsed.templateId, actorId);
        return jsonOk({ template });
      }
      case "unarchive": {
        const template = await unarchiveTemplate(parsed.templateId, actorId);
        return jsonOk({ template });
      }
      case "delete_template": {
        await permanentlyDeleteTemplate(parsed.templateId);
        return jsonOk({ deleted: true });
      }
      case "update_meta": {
        const template = await updateTemplateMeta({
          id: parsed.templateId,
          name: parsed.name,
          description: parsed.description,
          actorId,
        });
        return jsonOk({ template });
      }
      case "add_section": {
        const template = await addSection({
          templateId: parsed.templateId,
          title: parsed.title,
          actorId,
        });
        return jsonOk({ template });
      }
      case "update_section": {
        const template = await updateSection({
          sectionId: parsed.sectionId,
          title: parsed.title,
          actorId,
        });
        return jsonOk({ template });
      }
      case "delete_section": {
        const template = await deleteSection({
          sectionId: parsed.sectionId,
          actorId,
        });
        return jsonOk({ template });
      }
      case "reorder_sections": {
        const template = await reorderSections({
          templateId: parsed.templateId,
          orderedIds: parsed.orderedIds,
          actorId,
        });
        return jsonOk({ template });
      }
      case "add_item": {
        const template = await addItem({
          templateId: parsed.templateId,
          sectionId: parsed.sectionId,
          title: parsed.title,
          guideNotes: parsed.guideNotes,
          isCoverPhotoSource: parsed.isCoverPhotoSource,
          allowsMedia: parsed.allowsMedia,
          allowsNotes: parsed.allowsNotes,
          actorId,
        });
        return jsonOk({ template });
      }
      case "update_item": {
        const template = await updateItem({
          itemId: parsed.itemId,
          title: parsed.title,
          guideNotes: parsed.guideNotes,
          isCoverPhotoSource: parsed.isCoverPhotoSource,
          allowsMedia: parsed.allowsMedia,
          allowsNotes: parsed.allowsNotes,
          actorId,
        });
        return jsonOk({ template });
      }
      case "delete_item": {
        const template = await deleteItem({ itemId: parsed.itemId, actorId });
        return jsonOk({ template });
      }
      case "reorder_items": {
        const template = await reorderItems({
          templateId: parsed.templateId,
          sectionId: parsed.sectionId,
          orderedIds: parsed.orderedIds,
          actorId,
        });
        return jsonOk({ template });
      }
      case "move_item": {
        const template = await moveItem({
          itemId: parsed.itemId,
          targetSectionId: parsed.targetSectionId,
          orderedIds: parsed.orderedIds,
          actorId,
        });
        return jsonOk({ template });
      }
      case "add_sub_question": {
        const template = await addSubQuestion({
          itemId: parsed.itemId,
          prompt: parsed.prompt,
          questionType: parsed.questionType,
          options: parsed.options,
          actorId,
        });
        return jsonOk({ template });
      }
      case "update_sub_question": {
        const template = await updateSubQuestion({
          subQuestionId: parsed.subQuestionId,
          prompt: parsed.prompt,
          questionType: parsed.questionType,
          actorId,
        });
        return jsonOk({ template });
      }
      case "delete_sub_question": {
        const template = await deleteSubQuestion({
          subQuestionId: parsed.subQuestionId,
          actorId,
        });
        return jsonOk({ template });
      }
      case "reorder_sub_questions": {
        const template = await reorderSubQuestions({
          itemId: parsed.itemId,
          orderedIds: parsed.orderedIds,
          actorId,
        });
        return jsonOk({ template });
      }
      case "add_option": {
        const template = await addOption({
          subQuestionId: parsed.subQuestionId,
          label: parsed.label,
          actorId,
        });
        return jsonOk({ template });
      }
      case "update_option": {
        const template = await updateOption({
          optionId: parsed.optionId,
          label: parsed.label,
          actorId,
        });
        return jsonOk({ template });
      }
      case "delete_option": {
        const template = await deleteOption({ optionId: parsed.optionId, actorId });
        return jsonOk({ template });
      }
      case "reorder_options": {
        const template = await reorderOptions({
          subQuestionId: parsed.subQuestionId,
          orderedIds: parsed.orderedIds,
          actorId,
        });
        return jsonOk({ template });
      }
      default: {
        const _exhaustive: never = parsed;
        return _exhaustive;
      }
    }
  } catch (error) {
    return jsonError(error, "POST /api/inspections/templates");
  }
}
