/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SurveyResultsClient } from "@/components/surveys/survey-results-client";
import { SurveysListClient } from "@/components/surveys/surveys-list-client";
import type { SurveyDetail, SurveyResponse, SurveySummary } from "@/lib/surveys/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => cleanup());

const CREATOR = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const SUMMARY: SurveySummary = {
  id: "s1",
  title: "Team pulse",
  description: null,
  publicToken: "abcdefghijklmnopqrstu",
  displayMode: "all_on_one_page",
  identityMode: "name_optional",
  createdBy: CREATOR,
  createdByName: "Creator",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  responseCount: 1,
  lastResponseAt: "2026-10-02T00:00:00.000Z",
  questionCount: 1,
};

const DETAIL: SurveyDetail = {
  ...SUMMARY,
  questions: [
    {
      id: "q1",
      surveyId: "s1",
      position: 0,
      prompt: "Rate us",
      helpText: null,
      type: "star_rating",
      required: true,
      options: [],
      archivedAt: null,
    },
  ],
  responseCount: 1,
  answeredQuestionIds: ["q1"],
};

const RESPONSES: SurveyResponse[] = [
  {
    id: "r1",
    surveyId: "s1",
    submittedAt: "2026-10-02T00:00:00.000Z",
    respondentUserId: null,
    respondentName: "Pat",
    respondentEmail: null,
    answers: [{ questionId: "q1", ratingValue: 5, textValue: null, optionIds: null }],
  },
];

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Actions for Team pulse" }));
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

describe("survey list actions", () => {
  it("hides Edit and Delete from a teammate who isn't the creator or an admin", () => {
    render(
      <SurveysListClient
        initialSurveys={[SUMMARY]}
        viewer={{ id: OTHER, profile: { role: "user" } }}
        loadError={null}
      />,
    );
    expect(screen.queryByRole("link", { name: "Edit Team pulse" })).toBeNull();
    expect(openMenu()).toEqual([
      "Responses & Analytics",
      "Copy link",
      "Open survey",
      "Share to Slack",
      "Duplicate",
    ]);
  });

  it("shows Edit and Delete to the creator and to admins", () => {
    for (const viewer of [
      { id: CREATOR, profile: { role: "user" } },
      { id: OTHER, profile: { role: "admin" } },
    ]) {
      render(<SurveysListClient initialSurveys={[SUMMARY]} viewer={viewer} loadError={null} />);
      expect(screen.getByRole("link", { name: "Edit Team pulse" })).toBeTruthy();
      expect(openMenu()).toContain("Delete");
      cleanup();
    }
  });
});

describe("survey results actions", () => {
  it("hides Edit and Delete response when the viewer can't edit", () => {
    render(<SurveyResultsClient survey={DETAIL} initialResponses={RESPONSES} canEdit={false} />);
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Individual" }));
    expect(screen.getByTestId("response-position").textContent).toBe("Response 1 of 1");
    expect(screen.queryByRole("button", { name: "Delete response" })).toBeNull();
  });

  it("shows them to an editor", () => {
    render(<SurveyResultsClient survey={DETAIL} initialResponses={RESPONSES} canEdit />);
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Individual" }));
    expect(screen.getByRole("button", { name: "Delete response" })).toBeTruthy();
  });
});
