/**
 * Survey validation shared by the builder, the respondent page, and the API.
 */

import { z } from "zod";
import {
  SURVEY_DISPLAY_MODES,
  SURVEY_IDENTITY_MODES,
  SURVEY_QUESTION_TYPES,
  SURVEY_TEXT_ANSWER_MAX,
  questionTypeHasOptions,
  type PublicSurvey,
  type SurveyAnswer,
  type SurveyIdentityMode,
} from "./types";

export const SURVEY_TITLE_MAX = 200;
export const SURVEY_DESCRIPTION_MAX = 2000;
export const SURVEY_PROMPT_MAX = 500;
export const SURVEY_HELP_TEXT_MAX = 1000;
export const SURVEY_OPTION_LABEL_MAX = 200;
export const SURVEY_MAX_QUESTIONS = 100;
export const SURVEY_MAX_OPTIONS = 50;
export const SURVEY_RESPONDENT_FIELD_MAX = 200;

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the survey a title.")
  .max(SURVEY_TITLE_MAX, `Keep the title under ${SURVEY_TITLE_MAX} characters.`);

const descriptionSchema = z
  .string()
  .trim()
  .max(SURVEY_DESCRIPTION_MAX, `Keep the description under ${SURVEY_DESCRIPTION_MAX} characters.`)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const createSurveySchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
});
export type CreateSurveyInput = z.infer<typeof createSurveySchema>;

export const surveyOptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().max(SURVEY_OPTION_LABEL_MAX),
});

export const surveyQuestionInputSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    prompt: z
      .string()
      .trim()
      .min(1, "Every question needs a prompt.")
      .max(SURVEY_PROMPT_MAX, `Keep prompts under ${SURVEY_PROMPT_MAX} characters.`),
    helpText: z
      .string()
      .trim()
      .max(SURVEY_HELP_TEXT_MAX)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    type: z.enum(SURVEY_QUESTION_TYPES),
    required: z.boolean().default(false),
    options: z.array(surveyOptionSchema).max(SURVEY_MAX_OPTIONS).default([]),
  })
  .superRefine((q, ctx) => {
    if (!questionTypeHasOptions(q.type)) return;
    const label = q.prompt || "This question";
    if (q.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `“${label}” needs at least 2 options.`,
      });
      return;
    }
    if (q.options.some((o) => !o.label)) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `“${label}” has an empty option.`,
      });
      return;
    }
    const labels = new Set<string>();
    const ids = new Set<string>();
    for (const option of q.options) {
      const key = option.label.toLowerCase();
      if (labels.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: `“${label}” lists “${option.label}” more than once.`,
        });
        return;
      }
      if (ids.has(option.id)) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Option ids must be unique." });
        return;
      }
      labels.add(key);
      ids.add(option.id);
    }
  })
  .transform((q) => ({
    ...q,
    options: questionTypeHasOptions(q.type) ? q.options : [],
  }));
export type SurveyQuestionInput = z.infer<typeof surveyQuestionInputSchema>;

export const saveSurveySchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    displayMode: z.enum(SURVEY_DISPLAY_MODES),
    identityMode: z.enum(SURVEY_IDENTITY_MODES),
    questions: z
      .array(surveyQuestionInputSchema)
      .max(SURVEY_MAX_QUESTIONS, `A survey can have up to ${SURVEY_MAX_QUESTIONS} questions.`),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    for (const q of s.questions) {
      if (ids.has(q.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions"],
          message: "Question ids must be unique.",
        });
        return;
      }
      ids.add(q.id);
    }
  });
export type SaveSurveyInput = z.infer<typeof saveSurveySchema>;

/** First validation message for a draft, or null when it can be saved. */
export function firstSurveyDraftError(input: unknown): string | null {
  const result = saveSurveySchema.safeParse(input);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Check the survey for errors.");
}

export const shareSurveyToSlackSchema = z.object({
  channelId: z.string().trim().min(1, "Pick a Slack channel."),
  message: z.string().trim().max(1000).optional().default(""),
});

// ---------------------------------------------------------------------------
// Respondent submissions
// ---------------------------------------------------------------------------

export const surveySubmissionSchema = z.object({
  name: z.string().max(SURVEY_RESPONDENT_FIELD_MAX).optional().default(""),
  email: z.string().max(SURVEY_RESPONDENT_FIELD_MAX).optional().default(""),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(500).optional().default(""),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(64),
        ratingValue: z.number().nullable().optional(),
        textValue: z.string().nullable().optional(),
        optionIds: z.array(z.string().max(64)).max(SURVEY_MAX_OPTIONS).nullable().optional(),
      }),
    )
    .max(SURVEY_MAX_QUESTIONS * 2),
});
export type SurveySubmissionInput = z.input<typeof surveySubmissionSchema>;

export type SubmissionValidation =
  | {
      ok: true;
      respondentName: string | null;
      respondentEmail: string | null;
      answers: SurveyAnswer[];
    }
  | { ok: false; errors: Record<string, string>; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RESPONDENT_NAME_FIELD = "__name";
export const RESPONDENT_EMAIL_FIELD = "__email";

type SubmissionQuestion = PublicSurvey["questions"][number];

/**
 * Validate one respondent submission against the survey's active questions.
 * Used on the respondent page for inline errors and again on the server.
 * Anonymous surveys always drop name and email.
 */
export function validateSurveySubmission(
  survey: { identityMode: SurveyIdentityMode; questions: SubmissionQuestion[] },
  submission: {
    name?: string;
    email?: string;
    answers: Array<{
      questionId: string;
      ratingValue?: number | null;
      textValue?: string | null;
      optionIds?: string[] | null;
    }>;
  },
  options: { onlyQuestionIds?: string[]; skipIdentity?: boolean } = {},
): SubmissionValidation {
  const errors: Record<string, string> = {};
  const byId = new Map(survey.questions.map((q) => [q.id, q]));
  const given = new Map<string, (typeof submission.answers)[number]>();

  for (const answer of submission.answers) {
    if (!byId.has(answer.questionId)) {
      return {
        ok: false,
        errors: { [answer.questionId]: "Unknown question." },
        message: "This survey changed since you opened it. Reload the page and try again.",
      };
    }
    if (given.has(answer.questionId)) {
      return {
        ok: false,
        errors: { [answer.questionId]: "Answered twice." },
        message: "Each question can only be answered once.",
      };
    }
    given.set(answer.questionId, answer);
  }

  let respondentName: string | null = null;
  let respondentEmail: string | null = null;
  if (survey.identityMode !== "anonymous") {
    respondentName = (submission.name ?? "").trim() || null;
    respondentEmail = (submission.email ?? "").trim() || null;
    if (!options.skipIdentity) {
      if (survey.identityMode === "name_required" && !respondentName) {
        errors[RESPONDENT_NAME_FIELD] = "Please enter your name.";
      }
      if (respondentEmail && !EMAIL_PATTERN.test(respondentEmail)) {
        errors[RESPONDENT_EMAIL_FIELD] = "Enter a valid email or leave it blank.";
      }
    }
  }

  const scope = options.onlyQuestionIds ? new Set(options.onlyQuestionIds) : null;
  const answers: SurveyAnswer[] = [];

  for (const question of survey.questions) {
    if (scope && !scope.has(question.id)) continue;
    const raw = given.get(question.id);
    let normalized: SurveyAnswer | null = null;

    if (question.type === "star_rating") {
      const value = raw?.ratingValue;
      if (value !== null && value !== undefined) {
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          errors[question.id] = "Pick a rating from 1 to 5.";
          continue;
        }
        normalized = {
          questionId: question.id,
          ratingValue: value,
          textValue: null,
          optionIds: null,
        };
      }
    } else if (question.type === "text") {
      const text = (raw?.textValue ?? "").trim();
      if (text.length > SURVEY_TEXT_ANSWER_MAX) {
        errors[question.id] = `Keep your answer under ${SURVEY_TEXT_ANSWER_MAX} characters.`;
        continue;
      }
      if (text) {
        normalized = {
          questionId: question.id,
          ratingValue: null,
          textValue: text,
          optionIds: null,
        };
      }
    } else {
      const known = new Set(question.options.map((o) => o.id));
      const ids = Array.from(new Set(raw?.optionIds ?? []));
      if (ids.some((id) => !known.has(id))) {
        errors[question.id] = "That option is no longer available. Reload the page.";
        continue;
      }
      if (question.type === "dropdown" && ids.length > 1) {
        errors[question.id] = "Pick one option.";
        continue;
      }
      if (ids.length > 0) {
        const ordered = question.options.map((o) => o.id).filter((id) => ids.includes(id));
        normalized = {
          questionId: question.id,
          ratingValue: null,
          textValue: null,
          optionIds: ordered,
        };
      }
    }

    if (!normalized) {
      if (question.required) errors[question.id] = "This question is required.";
      continue;
    }
    answers.push(normalized);
  }

  const errorCount = Object.keys(errors).length;
  if (errorCount > 0) {
    return {
      ok: false,
      errors,
      message:
        errorCount === 1
          ? "Please fix the highlighted question."
          : "Please fix the highlighted questions.",
    };
  }
  return { ok: true, respondentName, respondentEmail, answers };
}
