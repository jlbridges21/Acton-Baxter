import * as XLSX from "xlsx";
import { exportQuestions, formatAnswer, respondentLabel } from "./analytics";
import type { SurveyDetail, SurveyResponse } from "./types";

type ExportSurvey = Pick<SurveyDetail, "identityMode" | "questions">;

/**
 * Header row plus one row per response, oldest first. Anonymous surveys
 * have no Respondent column. Multi-select answers are joined with "; ".
 */
export function buildSurveyXlsxRows(
  survey: ExportSurvey,
  responses: SurveyResponse[],
): Array<Array<string | number>> {
  const anonymous = survey.identityMode === "anonymous";
  const questions = exportQuestions(survey.questions, responses);
  const header = [
    "Submitted At",
    ...(anonymous ? [] : ["Respondent"]),
    ...questions.map((q) => (q.archivedAt ? `${q.prompt} (removed)` : q.prompt)),
  ];
  const ordered = [...responses].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const rows = ordered.map((response) => {
    const cells: Array<string | number> = [response.submittedAt];
    if (!anonymous) cells.push(respondentLabel(response, survey.identityMode) ?? "");
    for (const q of questions) {
      const answer = response.answers.find((a) => a.questionId === q.id);
      if (q.type === "star_rating" && answer?.ratingValue) cells.push(answer.ratingValue);
      else cells.push(formatAnswer(q, answer));
    }
    return cells;
  });
  return [header, ...rows];
}

export function buildSurveyXlsx(survey: ExportSurvey, responses: SurveyResponse[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(buildSurveyXlsxRows(survey, responses));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Responses");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
