import { describe, expect, it } from "vitest";
import {
  RESPONDENT_EMAIL_FIELD,
  RESPONDENT_NAME_FIELD,
  createSurveySchema,
  firstSurveyDraftError,
  saveSurveySchema,
  validateSurveySubmission,
} from "@/lib/surveys/schemas";
import type { PublicSurvey } from "@/lib/surveys/types";

const BASE = {
  title: "Client survey",
  description: "",
  displayMode: "all_on_one_page" as const,
  identityMode: "name_optional" as const,
};

describe("survey builder validation", () => {
  it("requires a title", () => {
    expect(createSurveySchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createSurveySchema.parse({ title: " Hi ", description: "" })).toEqual({
      title: "Hi",
      description: null,
    });
  });

  it("requires every question to have a prompt", () => {
    expect(
      firstSurveyDraftError({
        ...BASE,
        questions: [{ id: "q1", prompt: " ", type: "text", required: false, options: [] }],
      }),
    ).toBe("Every question needs a prompt.");
  });

  it("requires at least two unique, non-empty options for dropdown and multi-select", () => {
    const q = (options: Array<{ id: string; label: string }>, type = "dropdown") => ({
      ...BASE,
      questions: [{ id: "q1", prompt: "Pick", type, required: false, options }],
    });
    expect(firstSurveyDraftError(q([{ id: "a", label: "Yes" }]))).toMatch(/at least 2 options/);
    expect(
      firstSurveyDraftError(
        q([
          { id: "a", label: "Yes" },
          { id: "b", label: " " },
        ]),
      ),
    ).toMatch(/empty option/);
    expect(
      firstSurveyDraftError(
        q(
          [
            { id: "a", label: "Yes" },
            { id: "b", label: "yes" },
          ],
          "multi_select",
        ),
      ),
    ).toMatch(/more than once/);
    expect(
      firstSurveyDraftError(
        q([
          { id: "a", label: "Yes" },
          { id: "b", label: "No" },
        ]),
      ),
    ).toBeNull();
  });

  it("drops options from question types that don't use them", () => {
    const parsed = saveSurveySchema.parse({
      ...BASE,
      questions: [
        {
          id: "q1",
          prompt: "Rate us",
          type: "star_rating",
          required: true,
          options: [{ id: "x", label: "x" }],
        },
      ],
    });
    expect(parsed.questions[0]?.options).toEqual([]);
  });

  it("allows saving with zero questions (the link stays unusable until one exists)", () => {
    expect(firstSurveyDraftError({ ...BASE, questions: [] })).toBeNull();
  });
});

const SURVEY: PublicSurvey = {
  token: "t",
  title: "S",
  description: null,
  displayMode: "all_on_one_page",
  identityMode: "name_required",
  questions: [
    {
      id: "star",
      prompt: "Rate",
      helpText: null,
      type: "star_rating",
      required: true,
      options: [],
    },
    { id: "text", prompt: "Why", helpText: null, type: "text", required: false, options: [] },
    {
      id: "drop",
      prompt: "Pick one",
      helpText: null,
      type: "dropdown",
      required: true,
      options: [
        { id: "y", label: "Yes" },
        { id: "n", label: "No" },
      ],
    },
    {
      id: "multi",
      prompt: "Pick any",
      helpText: null,
      type: "multi_select",
      required: false,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
  ],
};

describe("validateSurveySubmission", () => {
  it("accepts a complete submission and normalizes option order", () => {
    const result = validateSurveySubmission(SURVEY, {
      name: " Pat ",
      email: "pat@example.com",
      answers: [
        { questionId: "star", ratingValue: 4 },
        { questionId: "drop", optionIds: ["n"] },
        { questionId: "multi", optionIds: ["b", "a"] },
        { questionId: "text", textValue: "  " },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.respondentName).toBe("Pat");
    expect(result.answers.map((a) => a.questionId)).toEqual(["star", "drop", "multi"]);
    expect(result.answers.find((a) => a.questionId === "multi")?.optionIds).toEqual(["a", "b"]);
  });

  it("flags missing required answers and a missing required name", () => {
    const result = validateSurveySubmission(SURVEY, { name: "", answers: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [RESPONDENT_NAME_FIELD, "drop", "star"].sort(),
    );
  });

  it("rejects ratings outside 1–5, unknown questions, and unknown options", () => {
    const bad = (answers: Parameters<typeof validateSurveySubmission>[1]["answers"]) =>
      validateSurveySubmission(SURVEY, { name: "Pat", answers });
    expect(
      bad([
        { questionId: "star", ratingValue: 6 },
        { questionId: "drop", optionIds: ["y"] },
      ]).ok,
    ).toBe(false);
    expect(
      bad([
        { questionId: "star", ratingValue: 2.5 },
        { questionId: "drop", optionIds: ["y"] },
      ]).ok,
    ).toBe(false);
    expect(bad([{ questionId: "nope", textValue: "x" }]).ok).toBe(false);
    expect(
      bad([
        { questionId: "star", ratingValue: 3 },
        { questionId: "drop", optionIds: ["zzz"] },
      ]).ok,
    ).toBe(false);
    expect(
      bad([
        { questionId: "star", ratingValue: 3 },
        { questionId: "drop", optionIds: ["y", "n"] },
      ]).ok,
    ).toBe(false);
  });

  it("rejects text answers over 5,000 characters and bad emails", () => {
    const result = validateSurveySubmission(SURVEY, {
      name: "Pat",
      email: "not-an-email",
      answers: [
        { questionId: "star", ratingValue: 3 },
        { questionId: "drop", optionIds: ["y"] },
        { questionId: "text", textValue: "x".repeat(5001) },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.text).toMatch(/5000/);
    expect(result.errors[RESPONDENT_EMAIL_FIELD]).toBeDefined();
  });

  it("drops name and email for anonymous surveys", () => {
    const result = validateSurveySubmission(
      { ...SURVEY, identityMode: "anonymous" },
      {
        name: "Pat",
        email: "pat@example.com",
        answers: [
          { questionId: "star", ratingValue: 3 },
          { questionId: "drop", optionIds: ["y"] },
        ],
      },
    );
    expect(result).toMatchObject({ ok: true, respondentName: null, respondentEmail: null });
  });

  it("validates one step at a time when scoped", () => {
    const step = validateSurveySubmission(
      SURVEY,
      { name: "", answers: [{ questionId: "star", ratingValue: 5 }] },
      { onlyQuestionIds: ["star"], skipIdentity: true },
    );
    expect(step.ok).toBe(true);
  });
});
