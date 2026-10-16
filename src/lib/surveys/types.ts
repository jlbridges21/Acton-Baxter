export const SURVEY_DISPLAY_MODES = ["all_on_one_page", "one_at_a_time"] as const;
export type SurveyDisplayMode = (typeof SURVEY_DISPLAY_MODES)[number];

export const SURVEY_IDENTITY_MODES = ["anonymous", "name_optional", "name_required"] as const;
export type SurveyIdentityMode = (typeof SURVEY_IDENTITY_MODES)[number];

export const SURVEY_QUESTION_TYPES = ["star_rating", "text", "dropdown", "multi_select"] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  star_rating: "Star rating (1–5)",
  text: "Text answer",
  dropdown: "Dropdown (pick one)",
  multi_select: "Multi-select (pick any)",
};

export const SURVEY_DISPLAY_MODE_LABELS: Record<SurveyDisplayMode, string> = {
  all_on_one_page: "All questions on one page",
  one_at_a_time: "One question at a time",
};

export const SURVEY_IDENTITY_MODE_LABELS: Record<SurveyIdentityMode, string> = {
  anonymous: "Anonymous",
  name_optional: "Ask for name (optional)",
  name_required: "Require name",
};

export const SURVEY_TEXT_ANSWER_MAX = 5000;

export function questionTypeHasOptions(type: SurveyQuestionType): boolean {
  return type === "dropdown" || type === "multi_select";
}

export type SurveyOption = { id: string; label: string };

export type SurveyQuestion = {
  id: string;
  surveyId: string;
  position: number;
  prompt: string;
  helpText: string | null;
  type: SurveyQuestionType;
  required: boolean;
  options: SurveyOption[];
  archivedAt: string | null;
};

export type Survey = {
  id: string;
  title: string;
  description: string | null;
  publicToken: string;
  displayMode: SurveyDisplayMode;
  identityMode: SurveyIdentityMode;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SurveySummary = Survey & {
  responseCount: number;
  lastResponseAt: string | null;
  questionCount: number;
};

export type SurveyDetail = Survey & {
  /** Active questions first (by position), then archived questions. */
  questions: SurveyQuestion[];
  responseCount: number;
  /** Question ids that have at least one stored answer. */
  answeredQuestionIds: string[];
};

export type SurveyAnswer = {
  questionId: string;
  ratingValue: number | null;
  textValue: string | null;
  optionIds: string[] | null;
};

export type SurveyResponse = {
  id: string;
  surveyId: string;
  submittedAt: string;
  respondentUserId: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  answers: SurveyAnswer[];
};

/** What the public respondent page receives — no ids of people, no archived questions. */
export type PublicSurvey = {
  token: string;
  title: string;
  description: string | null;
  displayMode: SurveyDisplayMode;
  identityMode: SurveyIdentityMode;
  questions: Array<
    Pick<SurveyQuestion, "id" | "prompt" | "helpText" | "type" | "required" | "options">
  >;
};

export function activeQuestions<T extends Pick<SurveyQuestion, "archivedAt" | "position">>(
  questions: T[],
): T[] {
  return questions.filter((q) => !q.archivedAt).sort((a, b) => a.position - b.position);
}

export function toPublicSurvey(survey: SurveyDetail): PublicSurvey {
  return {
    token: survey.publicToken,
    title: survey.title,
    description: survey.description,
    displayMode: survey.displayMode,
    identityMode: survey.identityMode,
    questions: activeQuestions(survey.questions).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      helpText: q.helpText,
      type: q.type,
      required: q.required,
      options: q.options,
    })),
  };
}

export function publicSurveyPath(token: string): string {
  return `/s/${token}`;
}

export function publicSurveyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${publicSurveyPath(token)}`;
}

export function safeSurveyFilename(title: string): string {
  return (
    title
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "survey"
  );
}
