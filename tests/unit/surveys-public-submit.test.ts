import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getOptionalUser: vi.fn(),
}));

import { getOptionalUser } from "@/lib/auth/session";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import {
  createSurvey,
  getSurveyMemoryForTests,
  resetSurveyMemoryForTests,
  saveSurvey,
} from "@/lib/surveys/store";
import type { SurveyDetail, SurveyIdentityMode } from "@/lib/surveys/types";
import { GET } from "@/app/api/public/surveys/[token]/route";
import { POST } from "@/app/api/public/surveys/[token]/responses/route";

const CREATOR = "00000000-0000-4000-8000-0000000000c1";
const VIEWER = "00000000-0000-4000-8000-0000000000d1";

async function makeSurvey(identityMode: SurveyIdentityMode): Promise<SurveyDetail> {
  const survey = await createSurvey({ title: "Feedback", description: null, actorId: CREATOR });
  return saveSurvey(survey.id, {
    title: "Feedback",
    description: null,
    displayMode: "all_on_one_page",
    identityMode,
    questions: [
      {
        id: "new-1",
        prompt: "Rate us",
        helpText: null,
        type: "star_rating",
        required: true,
        options: [],
      },
    ],
  });
}

function submit(token: string, body: Record<string, unknown>, ip = "203.0.113.5") {
  return POST(
    new Request(`http://localhost/api/public/surveys/${token}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetSurveyMemoryForTests();
  resetRateLimitsForTests();
  vi.mocked(getOptionalUser).mockReset();
  vi.mocked(getOptionalUser).mockResolvedValue({
    id: VIEWER,
    email: "viewer@example.com",
    profile: {
      id: VIEWER,
      full_name: "Signed In Teammate",
      role: "user",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  });
});

describe("POST /api/public/surveys/[token]/responses", () => {
  it("never stores identity for anonymous surveys, even for a signed-in user who sends a name", async () => {
    const survey = await makeSurvey("anonymous");
    const qid = survey.questions[0]!.id;
    const res = await submit(survey.publicToken, {
      name: "Sneaky Name",
      email: "sneaky@example.com",
      answers: [{ questionId: qid, ratingValue: 5 }],
    });
    expect(res.status).toBe(201);
    const rows = Array.from(getSurveyMemoryForTests().responses.values());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      respondent_user_id: null,
      respondent_name: null,
      respondent_email: null,
    });
    expect(getOptionalUser).not.toHaveBeenCalled();
  });

  it("stores the signed-in user and prefilled name for named surveys", async () => {
    const survey = await makeSurvey("name_optional");
    const qid = survey.questions[0]!.id;
    const res = await submit(survey.publicToken, {
      answers: [{ questionId: qid, ratingValue: 4 }],
    });
    expect(res.status).toBe(201);
    const [row] = Array.from(getSurveyMemoryForTests().responses.values());
    expect(row).toMatchObject({
      respondent_user_id: VIEWER,
      respondent_name: "Signed In Teammate",
    });
  });

  it("rejects a filled honeypot without storing anything", async () => {
    const survey = await makeSurvey("name_optional");
    const qid = survey.questions[0]!.id;
    const res = await submit(survey.publicToken, {
      website: "http://spam.example",
      answers: [{ questionId: qid, ratingValue: 4 }],
    });
    expect(res.status).toBe(400);
    expect(getSurveyMemoryForTests().responses.size).toBe(0);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await submit("does-not-exist", { answers: [] });
    expect(res.status).toBe(404);
    const get = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ token: "does-not-exist" }),
    });
    expect(get.status).toBe(404);
  });

  it("re-validates on the server: unknown questions, bad ratings, missing required answers", async () => {
    const survey = await makeSurvey("name_optional");
    const qid = survey.questions[0]!.id;
    expect(
      (await submit(survey.publicToken, { answers: [{ questionId: "x", ratingValue: 3 }] })).status,
    ).toBe(400);
    expect(
      (await submit(survey.publicToken, { answers: [{ questionId: qid, ratingValue: 9 }] })).status,
    ).toBe(400);
    expect((await submit(survey.publicToken, { answers: [] })).status).toBe(400);
    expect(getSurveyMemoryForTests().responses.size).toBe(0);
  });

  it("rate-limits by IP", async () => {
    const survey = await makeSurvey("anonymous");
    const qid = survey.questions[0]!.id;
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      last = (
        await submit(
          survey.publicToken,
          { answers: [{ questionId: qid, ratingValue: 3 }] },
          "198.51.100.9",
        )
      ).status;
    }
    expect(last).toBe(429);
  });

  it("serves the public survey without archived questions or creator details", async () => {
    const survey = await makeSurvey("anonymous");
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ token: survey.publicToken }),
    });
    const body = (await res.json()) as { survey: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.survey).not.toHaveProperty("createdBy");
    expect(body.survey).not.toHaveProperty("id");
    expect((body.survey.questions as unknown[]).length).toBe(1);
  });
});
