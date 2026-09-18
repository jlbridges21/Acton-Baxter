import { z } from "zod";
import { INSPECTION_SUB_QUESTION_TYPES } from "./types";

export const questionTypeSchema = z.enum(INSPECTION_SUB_QUESTION_TYPES);

export const templateActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("duplicate"),
    templateId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("archive"),
    templateId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("unarchive"),
    templateId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("update_meta"),
    templateId: z.string().uuid(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("add_section"),
    templateId: z.string().uuid(),
    title: z.string().min(1),
  }),
  z.object({
    action: z.literal("update_section"),
    sectionId: z.string().uuid(),
    title: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete_section"),
    sectionId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reorder_sections"),
    templateId: z.string().uuid(),
    orderedIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    action: z.literal("add_item"),
    templateId: z.string().uuid(),
    sectionId: z.string().uuid().nullable(),
    title: z.string().min(1),
    guideNotes: z.string().optional(),
    isCoverPhotoSource: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("update_item"),
    itemId: z.string().uuid(),
    title: z.string().min(1).optional(),
    guideNotes: z.string().optional(),
    isCoverPhotoSource: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("delete_item"),
    itemId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reorder_items"),
    templateId: z.string().uuid(),
    sectionId: z.string().uuid().nullable(),
    orderedIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    action: z.literal("add_sub_question"),
    itemId: z.string().uuid(),
    prompt: z.string().min(1),
    questionType: questionTypeSchema,
    options: z.array(z.object({ label: z.string().min(1) })).optional(),
  }),
  z.object({
    action: z.literal("update_sub_question"),
    subQuestionId: z.string().uuid(),
    prompt: z.string().min(1).optional(),
    questionType: questionTypeSchema.optional(),
  }),
  z.object({
    action: z.literal("delete_sub_question"),
    subQuestionId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reorder_sub_questions"),
    itemId: z.string().uuid(),
    orderedIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    action: z.literal("add_option"),
    subQuestionId: z.string().uuid(),
    label: z.string().min(1),
  }),
  z.object({
    action: z.literal("update_option"),
    optionId: z.string().uuid(),
    label: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete_option"),
    optionId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reorder_options"),
    subQuestionId: z.string().uuid(),
    orderedIds: z.array(z.string().uuid()).min(1),
  }),
]);

export type TemplateAction = z.infer<typeof templateActionSchema>;
