import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireActiveUser: vi.fn(),
}));

import { requireActiveUser } from "@/lib/auth/session";
import { resetEnvCacheForTests } from "@/lib/env";
import { isAnonymousPublicPath } from "@/lib/public-paths";
import { canEditSurvey } from "@/lib/surveys/permissions";
import {
  createSurvey,
  getSurvey,
  insertSurveyResponse,
  resetSurveyMemoryForTests,
  saveSurvey,
} from "@/lib/surveys/store";
import { DELETE as deleteSurveyRoute, PUT } from "@/app/api/surveys/[id]/route";
import { DELETE as deleteResponseRoute } from "@/app/api/surveys/[id]/responses/[responseId]/route";
import { POST as duplicateRoute } from "@/app/api/surveys/[id]/duplicate/route";
import type { UserRole } from "@/lib/research/db-types";

const CREATOR = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";

function asUser(id: string, role: UserRole) {
  return {
    id,
    email: `${id}@example.com`,
    profile: {
      id,
      full_name: "Teammate",
      role,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const SAVE_BODY = {
  title: "Edited",
  description: null,
  displayMode: "all_on_one_page",
  identityMode: "name_optional",
  questions: [{ id: "new-1", prompt: "Rate us", type: "star_rating", required: true, options: [] }],
};

function put(id: string, body: unknown = SAVE_BODY) {
  return PUT(
    new Request(`http://localhost/api/surveys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
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
  vi.mocked(requireActiveUser).mockReset();
});

describe("canEditSurvey", () => {
  it("allows the creator and admins only", () => {
    const survey = { createdBy: CREATOR };
    expect(canEditSurvey(asUser(CREATOR, "user"), survey)).toBe(true);
    expect(canEditSurvey(asUser(ADMIN, "admin"), survey)).toBe(true);
    expect(canEditSurvey(asUser(ADMIN, "super_admin"), survey)).toBe(true);
    expect(canEditSurvey(asUser(OTHER, "user"), survey)).toBe(false);
  });
});

describe("survey routes enforce creator-or-admin", () => {
  it("blocks a non-creator user from saving, deleting, or deleting responses", async () => {
    const survey = await createSurvey({ title: "Mine", description: null, actorId: CREATOR });
    await saveSurvey(survey.id, { ...SAVE_BODY, title: "Mine" } as never);
    const { id: responseId } = await insertSurveyResponse({
      surveyId: survey.id,
      respondentUserId: null,
      respondentName: null,
      respondentEmail: null,
      answers: [],
    });
    vi.mocked(requireActiveUser).mockResolvedValue(asUser(OTHER, "user"));

    expect((await put(survey.id)).status).toBe(403);
    const del = await deleteSurveyRoute(new Request("http://localhost"), params(survey.id));
    expect(del.status).toBe(403);
    const delResponse = await deleteResponseRoute(new Request("http://localhost"), {
      params: Promise.resolve({ id: survey.id, responseId }),
    });
    expect(delResponse.status).toBe(403);
    expect((await getSurvey(survey.id)).title).toBe("Mine");
  });

  it("lets an admin edit someone else's survey and anyone duplicate it", async () => {
    const survey = await createSurvey({ title: "Theirs", description: null, actorId: CREATOR });
    vi.mocked(requireActiveUser).mockResolvedValue(asUser(ADMIN, "admin"));
    const res = await put(survey.id);
    expect(res.status).toBe(200);
    expect((await getSurvey(survey.id)).title).toBe("Edited");

    vi.mocked(requireActiveUser).mockResolvedValue(asUser(OTHER, "user"));
    const dup = await duplicateRoute(new Request("http://localhost"), params(survey.id));
    const body = (await dup.json()) as { survey: { id: string; title: string; createdBy: string } };
    expect(dup.status).toBe(201);
    expect(body.survey.title).toBe("Copy of Edited");
    expect(body.survey.createdBy).toBe(OTHER);
    const copy = await getSurvey(body.survey.id);
    const original = await getSurvey(survey.id);
    expect(copy.publicToken).not.toBe(original.publicToken);
    expect(copy.questions.map((q) => q.prompt)).toEqual(["Rate us"]);
    expect(copy.questions[0]?.id).not.toBe(original.questions[0]?.id);
  });

  it("archives removed questions that have answers and blocks type changes", async () => {
    const survey = await createSurvey({ title: "S", description: null, actorId: CREATOR });
    const saved = await saveSurvey(survey.id, SAVE_BODY as never);
    const qid = saved.questions[0]!.id;
    await insertSurveyResponse({
      surveyId: survey.id,
      respondentUserId: null,
      respondentName: null,
      respondentEmail: null,
      answers: [{ questionId: qid, ratingValue: 4, textValue: null, optionIds: null }],
    });
    vi.mocked(requireActiveUser).mockResolvedValue(asUser(CREATOR, "user"));

    const typeChange = await put(survey.id, {
      ...SAVE_BODY,
      questions: [{ id: qid, prompt: "Rate us", type: "text", required: true, options: [] }],
    });
    expect(typeChange.status).toBe(400);

    const removed = await put(survey.id, { ...SAVE_BODY, questions: [] });
    expect(removed.status).toBe(200);
    const after = await getSurvey(survey.id);
    expect(after.questions).toHaveLength(1);
    expect(after.questions[0]?.archivedAt).not.toBeNull();
  });
});

describe("isAnonymousPublicPath", () => {
  it("opens the respondent page and public survey API, not the builder", () => {
    expect(isAnonymousPublicPath("/s/abc123")).toBe(true);
    expect(isAnonymousPublicPath("/api/public/surveys/abc123/responses")).toBe(true);
    expect(isAnonymousPublicPath("/tour/abc")).toBe(true);
    expect(isAnonymousPublicPath("/surveys")).toBe(false);
    expect(isAnonymousPublicPath("/surveys/abc/edit")).toBe(false);
    expect(isAnonymousPublicPath("/api/surveys/abc")).toBe(false);
    expect(isAnonymousPublicPath("/settings")).toBe(false);
  });
});
