import { describe, expect, it } from "vitest";
import {
  buildSurveyAnalytics,
  formatAnswer,
  redactResponses,
  respondentLabel,
} from "@/lib/surveys/analytics";
import type { SurveyQuestion, SurveyResponse } from "@/lib/surveys/types";

function question(
  overrides: Partial<SurveyQuestion> & Pick<SurveyQuestion, "id" | "type">,
): SurveyQuestion {
  return {
    surveyId: "s1",
    position: 0,
    prompt: overrides.id,
    helpText: null,
    required: false,
    options: [],
    archivedAt: null,
    ...overrides,
  };
}

const STAR = question({ id: "q-star", type: "star_rating", position: 0 });
const TEXT = question({ id: "q-text", type: "text", position: 1 });
const DROP = question({
  id: "q-drop",
  type: "dropdown",
  position: 2,
  options: [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ],
});
const MULTI = question({
  id: "q-multi",
  type: "multi_select",
  position: 3,
  options: [
    { id: "a", label: "Design" },
    { id: "b", label: "Permits" },
    { id: "c", label: "Build" },
  ],
});
const REMOVED = question({
  id: "q-old",
  type: "text",
  position: 4,
  archivedAt: "2026-10-01T00:00:00.000Z",
});
const REMOVED_UNANSWERED = question({
  id: "q-old-empty",
  type: "text",
  position: 5,
  archivedAt: "2026-10-02T00:00:00.000Z",
});

function response(
  id: string,
  answers: SurveyResponse["answers"],
  name: string | null = null,
): SurveyResponse {
  return {
    id,
    surveyId: "s1",
    submittedAt: `2026-10-1${id.slice(-1)}T12:00:00.000Z`,
    respondentUserId: null,
    respondentName: name,
    respondentEmail: null,
    answers,
  };
}

const a = (questionId: string, v: Partial<SurveyResponse["answers"][number]>) => ({
  questionId,
  ratingValue: null,
  textValue: null,
  optionIds: null,
  ...v,
});

const RESPONSES = [
  response(
    "r1",
    [
      a("q-star", { ratingValue: 5 }),
      a("q-text", { textValue: "Great team" }),
      a("q-drop", { optionIds: ["yes"] }),
      a("q-multi", { optionIds: ["a", "b"] }),
      a("q-old", { textValue: "legacy" }),
    ],
    "Robin",
  ),
  response("r2", [
    a("q-star", { ratingValue: 3 }),
    a("q-drop", { optionIds: ["no"] }),
    a("q-multi", { optionIds: ["a"] }),
  ]),
  response("r3", [a("q-star", { ratingValue: 4 }), a("q-text", { textValue: "   " })]),
];

const SURVEY = {
  identityMode: "name_optional" as const,
  questions: [STAR, TEXT, DROP, MULTI, REMOVED, REMOVED_UNANSWERED],
};

describe("buildSurveyAnalytics", () => {
  const analytics = buildSurveyAnalytics(SURVEY, RESPONSES);

  it("averages star ratings and builds a 1–5 distribution", () => {
    const star = analytics.questions.find((q) => q.question.id === "q-star");
    expect(star?.kind).toBe("star_rating");
    if (star?.kind !== "star_rating") return;
    expect(star.average).toBe(4);
    expect(star.answeredCount).toBe(3);
    expect(star.distribution.map((d) => d.count)).toEqual([0, 0, 1, 1, 1]);
    expect(star.distribution[4]?.percent).toBe(33.3);
    expect(star.ratings.map((r) => r.respondent)).toEqual([
      "Robin",
      "No name given",
      "No name given",
    ]);
  });

  it("lists non-blank text answers", () => {
    const text = analytics.questions.find((q) => q.question.id === "q-text");
    if (text?.kind !== "text") throw new Error("expected text");
    expect(text.answers.map((x) => x.text)).toEqual(["Great team"]);
  });

  it("counts dropdown picks against all responses and shows No answer for optional questions", () => {
    const drop = analytics.questions.find((q) => q.question.id === "q-drop");
    if (drop?.kind !== "dropdown") throw new Error("expected dropdown");
    expect(drop.options.map((o) => [o.label, o.count, o.percent])).toEqual([
      ["Yes", 1, 33.3],
      ["No", 1, 33.3],
    ]);
    expect(drop.noAnswer).toEqual({ count: 1, percent: 33.3 });

    const required = buildSurveyAnalytics(
      { ...SURVEY, questions: [{ ...DROP, required: true }] },
      RESPONSES,
    ).questions[0];
    if (required?.kind !== "dropdown") throw new Error("expected dropdown");
    expect(required.noAnswer).toBeNull();
  });

  it("uses respondents who answered as the multi-select base, so totals can exceed 100%", () => {
    const multi = analytics.questions.find((q) => q.question.id === "q-multi");
    if (multi?.kind !== "multi_select") throw new Error("expected multi");
    expect(multi.answeredCount).toBe(2);
    expect(multi.options.map((o) => o.percent)).toEqual([100, 50, 0]);
    expect(multi.options.reduce((sum, o) => sum + o.percent, 0)).toBeGreaterThan(100);
  });

  it("puts archived questions with answers under removed questions and drops empty ones", () => {
    expect(analytics.questions.map((q) => q.question.id)).toEqual([
      "q-star",
      "q-text",
      "q-drop",
      "q-multi",
    ]);
    expect(analytics.removedQuestions.map((q) => q.question.id)).toEqual(["q-old"]);
  });

  it("handles a survey with no responses", () => {
    const empty = buildSurveyAnalytics(SURVEY, []);
    const star = empty.questions[0];
    if (star?.kind !== "star_rating") throw new Error("expected star");
    expect(star.average).toBeNull();
    expect(empty.totalResponses).toBe(0);
    expect(empty.removedQuestions).toEqual([]);
  });

  it("never shows names for anonymous surveys", () => {
    const anon = buildSurveyAnalytics({ ...SURVEY, identityMode: "anonymous" }, RESPONSES);
    const star = anon.questions[0];
    if (star?.kind !== "star_rating") throw new Error("expected star");
    expect(star.ratings.every((r) => r.respondent === null)).toBe(true);
    expect(redactResponses(RESPONSES, "anonymous")[0]?.respondentName).toBeNull();
    expect(respondentLabel(RESPONSES[0]!, "anonymous")).toBeNull();
  });
});

describe("formatAnswer", () => {
  it("joins multi-select labels in option order with '; '", () => {
    expect(formatAnswer(MULTI, a("q-multi", { optionIds: ["b", "a"] }))).toBe("Design; Permits");
    expect(formatAnswer(STAR, a("q-star", { ratingValue: 4 }))).toBe("4");
    expect(formatAnswer(DROP, undefined)).toBe("");
  });
});
