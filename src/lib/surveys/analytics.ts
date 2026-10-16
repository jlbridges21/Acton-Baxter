/**
 * Pure survey result math — shared by the results page, PDF, and Excel export.
 */

import {
  activeQuestions,
  type SurveyAnswer,
  type SurveyIdentityMode,
  type SurveyQuestion,
  type SurveyResponse,
} from "./types";

export type RespondentRef = {
  responseId: string;
  submittedAt: string;
  /** Null when the survey is anonymous. */
  respondent: string | null;
};

export type OptionTally = { id: string; label: string; count: number; percent: number };

export type StarRatingSummary = {
  kind: "star_rating";
  question: SurveyQuestion;
  answeredCount: number;
  average: number | null;
  distribution: Array<{ value: 1 | 2 | 3 | 4 | 5; count: number; percent: number }>;
  ratings: Array<RespondentRef & { value: number }>;
};

export type TextSummary = {
  kind: "text";
  question: SurveyQuestion;
  answeredCount: number;
  answers: Array<RespondentRef & { text: string }>;
};

export type DropdownSummary = {
  kind: "dropdown";
  question: SurveyQuestion;
  answeredCount: number;
  /** Percent of all responses. */
  options: OptionTally[];
  /** Responses that skipped this question; shown only when it is optional. */
  noAnswer: { count: number; percent: number } | null;
};

export type MultiSelectSummary = {
  kind: "multi_select";
  question: SurveyQuestion;
  answeredCount: number;
  /** Percent of respondents who answered this question — totals can exceed 100%. */
  options: OptionTally[];
};

export type QuestionSummary =
  StarRatingSummary | TextSummary | DropdownSummary | MultiSelectSummary;

export type SurveyAnalytics = {
  totalResponses: number;
  questions: QuestionSummary[];
  /** Archived questions that still have answers. */
  removedQuestions: QuestionSummary[];
};

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

export function respondentLabel(
  response: Pick<SurveyResponse, "respondentName" | "respondentEmail">,
  identityMode: SurveyIdentityMode,
): string | null {
  if (identityMode === "anonymous") return null;
  const name = response.respondentName?.trim();
  const email = response.respondentEmail?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || "No name given";
}

/** Drop identity from every response when the survey is anonymous (older responses included). */
export function redactResponses(
  responses: SurveyResponse[],
  identityMode: SurveyIdentityMode,
): SurveyResponse[] {
  if (identityMode !== "anonymous") return responses;
  return responses.map((r) => ({
    ...r,
    respondentUserId: null,
    respondentName: null,
    respondentEmail: null,
  }));
}

function answerFor(response: SurveyResponse, questionId: string): SurveyAnswer | undefined {
  return response.answers.find((a) => a.questionId === questionId);
}

export function summarizeQuestion(
  question: SurveyQuestion,
  responses: SurveyResponse[],
  identityMode: SurveyIdentityMode,
): QuestionSummary {
  const ref = (r: SurveyResponse): RespondentRef => ({
    responseId: r.id,
    submittedAt: r.submittedAt,
    respondent: respondentLabel(r, identityMode),
  });

  if (question.type === "star_rating") {
    const ratings: StarRatingSummary["ratings"] = [];
    for (const r of responses) {
      const value = answerFor(r, question.id)?.ratingValue;
      if (typeof value === "number" && value >= 1 && value <= 5) ratings.push({ ...ref(r), value });
    }
    const total = ratings.reduce((sum, r) => sum + r.value, 0);
    const distribution = ([1, 2, 3, 4, 5] as const).map((value) => {
      const count = ratings.filter((r) => r.value === value).length;
      return { value, count, percent: percent(count, ratings.length) };
    });
    return {
      kind: "star_rating",
      question,
      answeredCount: ratings.length,
      average: ratings.length ? Math.round((total / ratings.length) * 100) / 100 : null,
      distribution,
      ratings,
    };
  }

  if (question.type === "text") {
    const answers: TextSummary["answers"] = [];
    for (const r of responses) {
      const text = answerFor(r, question.id)?.textValue?.trim();
      if (text) answers.push({ ...ref(r), text });
    }
    return { kind: "text", question, answeredCount: answers.length, answers };
  }

  const counts = new Map(question.options.map((o) => [o.id, 0]));
  let answeredCount = 0;
  for (const r of responses) {
    const ids = (answerFor(r, question.id)?.optionIds ?? []).filter((id) => counts.has(id));
    if (ids.length === 0) continue;
    answeredCount += 1;
    for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  if (question.type === "dropdown") {
    const base = responses.length;
    const noAnswerCount = base - answeredCount;
    return {
      kind: "dropdown",
      question,
      answeredCount,
      options: question.options.map((o) => ({
        id: o.id,
        label: o.label,
        count: counts.get(o.id) ?? 0,
        percent: percent(counts.get(o.id) ?? 0, base),
      })),
      noAnswer: question.required
        ? null
        : { count: noAnswerCount, percent: percent(noAnswerCount, base) },
    };
  }

  return {
    kind: "multi_select",
    question,
    answeredCount,
    options: question.options.map((o) => ({
      id: o.id,
      label: o.label,
      count: counts.get(o.id) ?? 0,
      percent: percent(counts.get(o.id) ?? 0, answeredCount),
    })),
  };
}

export function hasAnyAnswer(question: SurveyQuestion, responses: SurveyResponse[]): boolean {
  return responses.some((r) => {
    const a = answerFor(r, question.id);
    return Boolean(
      a && (a.ratingValue !== null || (a.textValue ?? "").trim() || (a.optionIds ?? []).length > 0),
    );
  });
}

export function buildSurveyAnalytics(
  survey: { identityMode: SurveyIdentityMode; questions: SurveyQuestion[] },
  responses: SurveyResponse[],
): SurveyAnalytics {
  const active = activeQuestions(survey.questions);
  const removed = survey.questions
    .filter((q) => q.archivedAt)
    .sort((a, b) => (a.archivedAt ?? "").localeCompare(b.archivedAt ?? ""))
    .filter((q) => hasAnyAnswer(q, responses));
  return {
    totalResponses: responses.length,
    questions: active.map((q) => summarizeQuestion(q, responses, survey.identityMode)),
    removedQuestions: removed.map((q) => summarizeQuestion(q, responses, survey.identityMode)),
  };
}

/** Human-readable value of one answer (Excel cells, individual response view). */
export function formatAnswer(question: SurveyQuestion, answer: SurveyAnswer | undefined): string {
  if (!answer) return "";
  if (question.type === "star_rating") return answer.ratingValue ? String(answer.ratingValue) : "";
  if (question.type === "text") return answer.textValue ?? "";
  const picked = new Set(answer.optionIds ?? []);
  return question.options
    .filter((o) => picked.has(o.id))
    .map((o) => o.label)
    .join("; ");
}

/** Questions that appear in exports: active ones, then removed ones that still have answers. */
export function exportQuestions(
  questions: SurveyQuestion[],
  responses: SurveyResponse[],
): SurveyQuestion[] {
  const removed = questions.filter((q) => q.archivedAt && hasAnyAnswer(q, responses));
  return [...activeQuestions(questions), ...removed];
}
