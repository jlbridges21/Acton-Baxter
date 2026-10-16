import { expect, test, type APIRequestContext } from "@playwright/test";

const QUESTIONS = [
  {
    id: "n1",
    prompt: "How smooth was the move?",
    type: "star_rating",
    required: true,
    options: [],
  },
  {
    id: "n2",
    prompt: "Is your desk set up?",
    type: "dropdown",
    required: true,
    options: [
      { id: "y", label: "Yes" },
      { id: "n", label: "No" },
    ],
  },
  {
    id: "n3",
    prompt: "What still needs fixing?",
    type: "multi_select",
    required: false,
    options: [
      { id: "w", label: "Wi-Fi" },
      { id: "p", label: "Parking" },
    ],
  },
  { id: "n4", prompt: "Anything else?", type: "text", required: false, options: [] },
];

async function seedSurvey(
  request: APIRequestContext,
  identityMode: "anonymous" | "name_required",
): Promise<{ id: string; publicToken: string }> {
  const created = await request.post("/api/surveys", { data: { title: `Pulse ${identityMode}` } });
  const { survey } = (await created.json()) as { survey: { id: string } };
  const saved = await request.put(`/api/surveys/${survey.id}`, {
    data: {
      title: `Pulse ${identityMode}`,
      description: null,
      displayMode: "one_at_a_time",
      identityMode,
      questions: QUESTIONS,
    },
  });
  return ((await saved.json()) as { survey: { id: string; publicToken: string } }).survey;
}

test("Surveys: one at a time, anonymous while signed in stores no identity", async ({
  page,
  request,
}) => {
  const survey = await seedSurvey(request, "anonymous");
  await page.goto(`/s/${survey.publicToken}`);
  await expect(page.getByTestId("survey-anonymous-note")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("This question is required.")).toBeVisible();
  await page.getByRole("radio", { name: "3 stars" }).click();
  await page.getByRole("radio", { name: "3 stars" }).press("ArrowRight");
  await expect(page.getByRole("radio", { name: "4 stars" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByLabel("Is your desk set up?").selectOption({ label: "No" });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Is your desk set up?")).toHaveValue("n");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByLabel("Wi-Fi").check();
  await page.getByLabel("Parking").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Anything else?").fill("Need more outlets.");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Thanks! Your response was recorded.")).toBeVisible();

  const res = await request.get(`/api/surveys/${survey.id}/responses`);
  const { responses } = (await res.json()) as {
    responses: Array<{
      respondentUserId: string | null;
      respondentName: string | null;
      answers: unknown[];
    }>;
  };
  expect(responses).toHaveLength(1);
  expect(responses[0]).toMatchObject({ respondentUserId: null, respondentName: null });
  expect(responses[0]?.answers).toHaveLength(4);
});

test("Surveys: one at a time asks for the name first and prefills it for signed-in users", async ({
  page,
  request,
}) => {
  const survey = await seedSurvey(request, "name_required");
  await page.goto(`/s/${survey.publicToken}`);
  await expect(page.getByText("Step 1 of 5")).toBeVisible();
  const name = page.getByLabel("Your name");
  await expect(name).toHaveValue("Test Salesperson");
  await name.fill("");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await name.fill("Jordan Field");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("How smooth was the move?")).toBeVisible();
});

test("Surveys: build all four question types, respond by link, see results and exports", async ({
  page,
  request,
}) => {
  await page.goto("/surveys");
  await expect(page.getByRole("heading", { name: "Surveys", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New Survey" }).click();
  await page.getByLabel("Title", { exact: true }).fill("E2E client survey");
  await page.getByRole("button", { name: "Create survey" }).click();
  await page.waitForURL(/\/surveys\/[0-9a-f-]+\/edit$/);
  const surveyId = page.url().split("/surveys/")[1]!.split("/")[0]!;

  const cards = page.getByTestId("survey-question-card");
  const addQuestion = page.getByRole("button", { name: "Add question" });

  await addQuestion.click();
  await cards.nth(0).getByLabel("Question 1", { exact: true }).fill("How did we do?");
  await cards.nth(0).getByLabel("Required", { exact: true }).check();

  await addQuestion.click();
  await cards.nth(1).getByLabel("Question 2", { exact: true }).fill("Anything else?");
  await cards.nth(1).getByLabel("Type", { exact: true }).selectOption("text");

  await addQuestion.click();
  await cards.nth(2).getByLabel("Question 3", { exact: true }).fill("Would you recommend us?");
  await cards.nth(2).getByLabel("Type", { exact: true }).selectOption("dropdown");
  await cards.nth(2).getByRole("button", { name: "Use Yes / No / N/A" }).click();

  await addQuestion.click();
  await cards.nth(3).getByLabel("Question 4", { exact: true }).fill("What stood out?");
  await cards.nth(3).getByLabel("Type", { exact: true }).selectOption("multi_select");
  await cards.nth(3).getByLabel("Option 1", { exact: true }).fill("Design");
  await cards.nth(3).getByLabel("Option 2", { exact: true }).fill("Permits");

  await page.getByRole("button", { name: "Save survey" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const link = await page.getByLabel("Survey link").inputValue();
  expect(link).toMatch(/\/s\/[\w-]{21}$/);

  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "E2E client survey" })).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("This question is required.")).toBeVisible();

  await page.getByRole("radio", { name: "4 stars" }).click();
  await page.getByLabel("Anything else?").fill("Clear communication.");
  await page.getByLabel("Would you recommend us?").selectOption({ label: "Yes" });
  await page.getByLabel("Design").check();
  await page.getByLabel("Permits").check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Thanks! Your response was recorded.")).toBeVisible();

  await page.goto(`/surveys/${surveyId}/responses`);
  await expect(page.getByTestId("star-average")).toHaveText("4.00");
  await expect(page.getByText("Clear communication.")).toBeVisible();
  await page.getByRole("tab", { name: "Individual" }).click();
  await expect(page.getByTestId("response-position")).toHaveText("Response 1 of 1");

  const xlsx = await request.get(`/api/surveys/${surveyId}/export-xlsx`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  const pdf = await request.get(`/api/surveys/${surveyId}/export-pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});
