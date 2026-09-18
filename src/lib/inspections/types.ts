/**
 * Site Inspection Checklist — template types.
 */

export const INSPECTION_SUB_QUESTION_TYPES = [
  "yes_no_na",
  "single_select",
  "multi_select",
  "text",
] as const;

export type InspectionSubQuestionType = (typeof INSPECTION_SUB_QUESTION_TYPES)[number];

export type InspectionTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  sectionCount: number;
  itemCount: number;
};

export type InspectionTemplateOption = {
  id: string;
  subQuestionId: string;
  label: string;
  sortOrder: number;
};

export type InspectionTemplateSubQuestion = {
  id: string;
  itemId: string;
  prompt: string;
  questionType: InspectionSubQuestionType;
  sortOrder: number;
  options: InspectionTemplateOption[];
};

export type InspectionTemplateItem = {
  id: string;
  templateId: string;
  sectionId: string | null;
  title: string;
  guideNotes: string;
  allowsMedia: boolean;
  allowsNotes: boolean;
  isCoverPhotoSource: boolean;
  sortOrder: number;
  subQuestions: InspectionTemplateSubQuestion[];
};

export type InspectionTemplateSection = {
  id: string;
  templateId: string;
  title: string;
  sortOrder: number;
  items: InspectionTemplateItem[];
};

export type InspectionTemplateDetail = InspectionTemplateSummary & {
  /** Standalone items (no section), e.g. cover photo — ordered by sortOrder. */
  standaloneItems: InspectionTemplateItem[];
  sections: InspectionTemplateSection[];
};

/** Seed / create payload (no ids). */
export type SeedOptionInput = { label: string };

export type SeedSubQuestionInput = {
  prompt: string;
  questionType: InspectionSubQuestionType;
  options?: SeedOptionInput[];
};

export type SeedItemInput = {
  title: string;
  guideNotes: string;
  isCoverPhotoSource?: boolean;
  subQuestions?: SeedSubQuestionInput[];
};

export type SeedSectionInput = {
  title: string;
  items: SeedItemInput[];
};

export type SeedTemplateInput = {
  name: string;
  description?: string | null;
  standaloneItems?: SeedItemInput[];
  sections: SeedSectionInput[];
};
