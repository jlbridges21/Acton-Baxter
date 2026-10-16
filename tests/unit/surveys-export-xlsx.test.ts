import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildSurveyXlsx, buildSurveyXlsxRows } from "@/lib/surveys/export-xlsx";
import type { SurveyQuestion, SurveyResponse } from "@/lib/surveys/types";

const QUESTIONS: SurveyQuestion[] = [
  {
    id: "q1",
    surveyId: "s",
    position: 0,
    prompt: "How did we do?",
    helpText: null,
    type: "star_rating",
    required: true,
    options: [],
    archivedAt: null,
  },
  {
    id: "q2",
    surveyId: "s",
    position: 1,
    prompt: "What helped?",
    helpText: null,
    type: "multi_select",
    required: false,
    options: [
      { id: "a", label: "Design" },
      { id: "b", label: "Permits" },
    ],
    archivedAt: null,
  },
  {
    id: "q3",
    surveyId: "s",
    position: 2,
    prompt: "Old question",
    helpText: null,
    type: "text",
    required: false,
    options: [],
    archivedAt: "2026-10-01T00:00:00.000Z",
  },
];

const RESPONSES: SurveyResponse[] = [
  {
    id: "r2",
    surveyId: "s",
    submittedAt: "2026-10-12T00:00:00.000Z",
    respondentUserId: null,
    respondentName: "Sam",
    respondentEmail: "sam@example.com",
    answers: [{ questionId: "q1", ratingValue: 5, textValue: null, optionIds: null }],
  },
  {
    id: "r1",
    surveyId: "s",
    submittedAt: "2026-10-11T00:00:00.000Z",
    respondentUserId: null,
    respondentName: null,
    respondentEmail: null,
    answers: [
      { questionId: "q1", ratingValue: 3, textValue: null, optionIds: null },
      { questionId: "q2", ratingValue: null, textValue: null, optionIds: ["a", "b"] },
      { questionId: "q3", ratingValue: null, textValue: "legacy", optionIds: null },
    ],
  },
];

describe("buildSurveyXlsxRows", () => {
  it("has Submitted At, Respondent, then one column per question, oldest response first", () => {
    const rows = buildSurveyXlsxRows(
      { identityMode: "name_optional", questions: QUESTIONS },
      RESPONSES,
    );
    expect(rows[0]).toEqual([
      "Submitted At",
      "Respondent",
      "How did we do?",
      "What helped?",
      "Old question (removed)",
    ]);
    expect(rows[1]).toEqual([
      "2026-10-11T00:00:00.000Z",
      "No name given",
      3,
      "Design; Permits",
      "legacy",
    ]);
    expect(rows[2]).toEqual(["2026-10-12T00:00:00.000Z", "Sam (sam@example.com)", 5, "", ""]);
  });

  it("omits the Respondent column for anonymous surveys", () => {
    const rows = buildSurveyXlsxRows(
      { identityMode: "anonymous", questions: QUESTIONS },
      RESPONSES,
    );
    expect(rows[0]).not.toContain("Respondent");
    expect(rows.flat()).not.toContain("Sam (sam@example.com)");
    expect(rows[0]?.[1]).toBe("How did we do?");
  });

  it("writes a readable workbook", () => {
    const bytes = buildSurveyXlsx(
      { identityMode: "name_optional", questions: QUESTIONS },
      RESPONSES,
    );
    const book = XLSX.read(bytes, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]!]!;
    const parsed = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1 });
    expect(parsed[0]?.[0]).toBe("Submitted At");
    expect(parsed).toHaveLength(3);
  });
});
