import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  getBaxterInquiryCount,
  getFeedbackDashboard,
  listFeedbackForAdmin,
  resetBaxterFeedbackMemoryForTests,
  upsertMessageFeedback,
  upsertSlackMessageFeedback,
} from "@/lib/baxter-ai/feedback";
import { listInquiriesForAdmin, summarizeInquiryRating } from "@/lib/baxter-ai/feedback-inquiries";
import {
  BAXTER_REPORTING_TIMEZONE,
  getZonedYmd,
  resolveFeedbackDateRange,
  zonedLocalToUtc,
} from "@/lib/baxter-ai/feedback-date-ranges";
import {
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateConversation,
  resetBaxterConversationMemoryForTests,
} from "@/lib/baxter-ai/conversations";
import {
  countActiveFeedbackFilters,
  buildFeedbackFilterHref,
  FEEDBACK_RANGE_PRESET_LINKS,
} from "@/components/admin/feedback-filters-panel";
import { assignUserDepartmentLabel } from "@/lib/org/departments";
import { getReportStore } from "@/lib/research/report-store";
import { resetSlackProfilesMemoryForTests, upsertSlackUserProfile } from "@/lib/slack/profiles";

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  resetEnvCacheForTests();
  resetBaxterConversationMemoryForTests();
  resetBaxterFeedbackMemoryForTests();
  resetSlackProfilesMemoryForTests();
});

describe("resolveFeedbackDateRange", () => {
  it("resolves this_week as Monday 00:00 Pacific through now", () => {
    const now = zonedLocalToUtc(2026, 7, 15, 15, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "this_week", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 7, 13, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(now.toISOString());
  });

  it("resolves last_month as the full previous calendar month", () => {
    const now = zonedLocalToUtc(2026, 8, 3, 11, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "last_month", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 7, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(zonedLocalToUtc(2026, 7, 31, 23, 59, 59).toISOString());
  });

  it("handles a DST spring-forward crossing for last_7_days in Pacific time", () => {
    const now = zonedLocalToUtc(2026, 3, 10, 15, 0, 0);
    const ymd = getZonedYmd(now, BAXTER_REPORTING_TIMEZONE);
    expect(ymd).toMatchObject({ year: 2026, month: 3, day: 10 });
    const bounds = resolveFeedbackDateRange({ preset: "last_7_days", now });
    expect(bounds.start).toBe("2026-03-04T08:00:00.000Z");
    expect(bounds.end).toBe("2026-03-10T22:00:00.000Z");
  });
});

describe("summarizeInquiryRating", () => {
  it("prioritizes negative over positive when mixed", () => {
    expect(summarizeInquiryRating([])).toBe("none");
    expect(summarizeInquiryRating([{ rating: "up" }])).toBe("positive");
    expect(summarizeInquiryRating([{ rating: "down" }])).toBe("negative");
    expect(summarizeInquiryRating([{ rating: "up" }, { rating: "down" }])).toBe("negative");
  });
});

async function seedInquiry(input: {
  channel: "web" | "slack";
  createdAt: string;
  userId?: string;
  rate?: "up" | "down" | null;
  secondRate?: "up" | "down";
  department?: string;
}) {
  const userId = input.userId ?? "00000000-0000-4000-8000-000000000001";
  if (input.channel === "web") {
    await getReportStore().ensureProfile({
      id: userId,
      full_name: "Web Asker",
      role: "user",
      department: input.department ?? null,
      department_name: input.department ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (input.department) {
      await assignUserDepartmentLabel(userId, input.department);
    }
  }

  const conversation = await getOrCreateConversation({
    userId: input.channel === "web" ? userId : null,
    userName: "Tester",
    channel: input.channel,
    externalThreadId: input.channel === "slack" ? `T1:C1:${input.createdAt}` : null,
    externalUserId: input.channel === "slack" ? "U_ASKER" : null,
  });
  await appendUserMessage({ conversationId: conversation.id, content: "Q?" });
  const assistant = await appendAssistantMessage({
    conversationId: conversation.id,
    content: "A.",
    insufficientKnowledge: false,
    confidence: "high",
    modelProvider: "openai",
    modelName: "test",
    sources: [],
    sourceEntryIds: [],
  });

  const mem = (
    globalThis as typeof globalThis & {
      __baxterConversationMemory?: {
        messages: Map<string, Array<{ id: string; created_at: string }>>;
      };
    }
  ).__baxterConversationMemory;
  const list = mem?.messages.get(conversation.id);
  const row = list?.find((m) => m.id === assistant.id);
  if (row) row.created_at = input.createdAt;

  async function stampFeedbackCreatedAt(feedbackId: string) {
    const fbMem = (
      globalThis as typeof globalThis & {
        __baxterFeedbackMemory?: {
          feedback: Map<string, { id: string; created_at: string }>;
        };
      }
    ).__baxterFeedbackMemory;
    for (const [key, fb] of fbMem?.feedback.entries() ?? []) {
      if (fb.id === feedbackId) {
        fbMem!.feedback.set(key, { ...fb, created_at: input.createdAt });
      }
    }
  }

  if (input.rate === "up" || input.rate === "down") {
    if (input.channel === "web") {
      const feedback = await upsertMessageFeedback({
        messageId: assistant.id,
        conversationId: conversation.id,
        userId,
        rating: input.rate,
      });
      await stampFeedbackCreatedAt(feedback.id);
    } else {
      const feedback = await upsertSlackMessageFeedback({
        messageId: assistant.id,
        conversationId: conversation.id,
        slackUserId: "U_REACTOR",
        slackTeamId: "T1",
        rating: input.rate,
      });
      await stampFeedbackCreatedAt(feedback.id);
    }
  }

  if (input.secondRate && input.channel === "slack") {
    const feedback = await upsertSlackMessageFeedback({
      messageId: assistant.id,
      conversationId: conversation.id,
      slackUserId: "U_REACTOR_2",
      slackTeamId: "T1",
      rating: input.secondRate,
    });
    await stampFeedbackCreatedAt(feedback.id);
  }

  return { conversation, assistant, userId };
}

describe("inquiry-based dashboard", () => {
  it("includes unrated inquiries under All and No feedback only", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-05T12:00:00.000Z",
      rate: null,
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-06T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000002",
      rate: "up",
    });

    const all = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      rating: "all",
    });
    expect(all.totalInquiries).toBe(2);
    expect(all.positiveCount + all.negativeCount + all.noFeedbackCount).toBe(all.totalInquiries);
    expect(all.noFeedbackCount).toBe(1);

    const none = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      rating: "none",
    });
    expect(none.rows).toHaveLength(1);
    expect(none.rows[0]?.summarizedRating).toBe("none");

    const positive = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      rating: "positive",
    });
    expect(positive.rows.every((r) => r.summarizedRating === "positive")).toBe(true);
    expect(positive.rows.some((r) => r.summarizedRating === "none")).toBe(false);
  });

  it("summarizes mixed feedback as negative and keeps both entries", async () => {
    const { assistant } = await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-10T12:00:00.000Z",
      rate: "up",
      secondRate: "down",
    });

    const listed = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      rating: "all",
    });
    const row = listed.rows.find((r) => r.messageId === assistant.id);
    expect(row?.summarizedRating).toBe("negative");
    expect(row?.feedbackEntries).toHaveLength(2);
    expect(row?.feedbackEntries.map((e) => e.rating).sort()).toEqual(["down", "up"]);
  });

  it("keeps the counts invariant across fixtures", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-01T12:00:00.000Z",
      rate: "up",
      department: "Sales",
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-02T12:00:00.000Z",
      rate: "down",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-03T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000003",
      rate: null,
      department: "Design",
    });

    const listed = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
    });
    expect(listed.positiveCount + listed.negativeCount + listed.noFeedbackCount).toBe(
      listed.totalInquiries,
    );
    expect(listed.totalInquiries).toBe(3);
  });

  it("filters by channel, department, and sorts by message created_at with unrated interleaved", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-01T12:00:00.000Z",
      rate: "up",
      department: "Sales",
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-02T12:00:00.000Z",
      rate: null,
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-03T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000004",
      rate: "down",
      department: "Sales",
    });

    const webOnly = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      channel: "web",
      sort: "oldest",
    });
    expect(webOnly.rows.every((r) => r.channel === "web")).toBe(true);
    expect(webOnly.rows.map((r) => r.createdAt)).toEqual([
      "2026-07-01T12:00:00.000Z",
      "2026-07-03T12:00:00.000Z",
    ]);

    const sales = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      department: "Sales",
    });
    expect(sales.rows.every((r) => r.department === "Sales")).toBe(true);
    // Slack unassigned excluded when filtering to Sales
    expect(sales.rows.some((r) => r.channel === "slack")).toBe(false);

    const allDepts = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
    });
    expect(allDepts.rows.some((r) => r.department == null)).toBe(true);
  });

  it("resolves web asker and filters by asker key", async () => {
    const { userId } = await seedInquiry({
      channel: "web",
      createdAt: "2026-07-05T12:00:00.000Z",
      rate: "up",
      department: "Ops",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-06T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000005",
      rate: null,
    });

    const askerKey = `web:${userId}`;
    const listed = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      askerKey,
    });
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.askerKey).toBe(askerKey);
    expect(listed.rows[0]?.askerLabel).toBe("Web Asker");
    expect(listed.rows[0]?.department).toBe("Ops");
  });

  it("resolves Slack asker key and leaves department Unassigned without email match", async () => {
    await upsertSlackUserProfile({
      team_id: "T1",
      slack_user_id: "U_ASKER",
      display_name: "Slack Asker",
      email: null,
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-08T12:00:00.000Z",
      rate: null,
    });

    const askerKey = "slack:T1:U_ASKER";
    const listed = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      askerKey,
    });
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.askerKey).toBe(askerKey);
    expect(listed.rows[0]?.askerLabel).toBe("Slack Asker");
    expect(listed.rows[0]?.department).toBeNull();

    const byDept = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      department: "Sales",
    });
    expect(byDept.rows.some((r) => r.askerKey === askerKey)).toBe(false);
  });
});

describe("getFeedbackDashboard + getBaxterInquiryCount", () => {
  it("returns inquiry rows and matching totals", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-05T12:00:00.000Z",
      rate: null,
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-10T12:00:00.000Z",
      rate: "down",
    });

    const dashboard = await getFeedbackDashboard({
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
      rating: "all",
      sort: "oldest",
    });

    expect(dashboard.totalInquiries).toBe(2);
    expect(dashboard.positiveCount + dashboard.negativeCount + dashboard.noFeedbackCount).toBe(2);
    expect(dashboard.rows).toHaveLength(2);
    expect(dashboard.rows.some((r) => r.summarizedRating === "none")).toBe(true);

    const count = await getBaxterInquiryCount({
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-31T23:59:59.999Z",
    });
    expect(count.total).toBe(2);
  });
});

describe("listFeedbackForAdmin defaults (feedback-row API)", () => {
  it("still returns feedback rows for callers that do not pass a date range", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-01-01T12:00:00.000Z",
      rate: "down",
    });
    const listed = await listFeedbackForAdmin({ rating: "all" });
    expect(listed.totalMatching).toBeGreaterThanOrEqual(1);
    expect(listed.negativeCount).toBeGreaterThanOrEqual(1);
  });
});

describe("filter panel active count", () => {
  it("is zero on defaults and non-zero when URL has non-default filters", () => {
    expect(
      countActiveFeedbackFilters({
        range: "this_month",
        rating: "all",
        channel: "all",
        sort: "newest",
        askerKeys: [],
        departments: [],
        customStart: "",
        customEnd: "",
      }),
    ).toBe(0);

    expect(
      countActiveFeedbackFilters({
        range: "last_month",
        rating: "none",
        channel: "slack",
        sort: "oldest",
        askerKeys: ["web:abc", "web:def"],
        departments: ["Sales", "Ops"],
        customStart: "",
        customEnd: "",
      }),
    ).toBe(8); // range + rating + channel + sort + 2 askers + 2 depts
  });

  it("counts each multi-select asker and department selection", () => {
    expect(
      countActiveFeedbackFilters({
        range: "this_month",
        rating: "all",
        channel: "all",
        sort: "newest",
        askerKeys: ["web:1", "web:2"],
        departments: ["Sales"],
        customStart: "",
        customEnd: "",
      }),
    ).toBe(3);
  });
});

describe("multi-select asker and department filters", () => {
  it("ORs multiple asker keys and departments; empty means unfiltered", async () => {
    const a = await seedInquiry({
      channel: "web",
      createdAt: "2026-07-05T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000011",
      rate: "up",
      department: "Sales",
    });
    const b = await seedInquiry({
      channel: "web",
      createdAt: "2026-07-06T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000012",
      rate: "down",
      department: "Ops",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-07T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000013",
      rate: null,
      department: "Design",
    });

    const range = { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" };

    const eitherAsker = await listInquiriesForAdmin({
      range,
      askerKeys: [`web:${a.userId}`, `web:${b.userId}`],
    });
    expect(eitherAsker.rows).toHaveLength(2);
    expect(eitherAsker.rows.map((r) => r.askerKey).sort()).toEqual(
      [`web:${a.userId}`, `web:${b.userId}`].sort(),
    );
    // Summary cards reflect multi-select filter
    expect(eitherAsker.totalInquiries).toBe(2);
    expect(
      eitherAsker.positiveCount + eitherAsker.negativeCount + eitherAsker.noFeedbackCount,
    ).toBe(2);

    const eitherDept = await listInquiriesForAdmin({
      range,
      departments: ["Sales", "Ops"],
    });
    expect(eitherDept.rows).toHaveLength(2);
    expect(eitherDept.rows.every((r) => r.department === "Sales" || r.department === "Ops")).toBe(
      true,
    );

    const unfiltered = await listInquiriesForAdmin({ range, askerKeys: [], departments: [] });
    expect(unfiltered.totalInquiries).toBe(3);
  });

  it("round-trips repeated asker/department URL params via buildFeedbackFilterHref", () => {
    const href = buildFeedbackFilterHref({
      range: "this_week",
      rating: "negative",
      askerKeys: ["web:aaa", "slack:T1:U1"],
      departments: ["Sales", "Ops"],
    });
    expect(href).toContain("range=this_week");
    expect(href).toContain("rating=negative");
    expect(href).toContain("asker=web%3Aaaa");
    expect(href).toContain("asker=slack%3AT1%3AU1");
    expect(href).toContain("department=Sales");
    expect(href).toContain("department=Ops");

    const qs = href.split("?")[1] ?? "";
    const params = new URLSearchParams(qs);
    expect(params.getAll("asker")).toEqual(["web:aaa", "slack:T1:U1"]);
    expect(params.getAll("department")).toEqual(["Sales", "Ops"]);
  });
});

describe("full question/answer text on inquiry rows", () => {
  it("includes full text alongside truncated excerpts", async () => {
    const longQ = `Q${"x".repeat(250)}`;
    const longA = `A${"y".repeat(300)}`;
    const createdAt = "2026-07-05T12:00:00.000Z";
    const { conversation, assistant } = await seedInquiry({
      channel: "web",
      createdAt,
      rate: null,
    });

    const mem = (
      globalThis as typeof globalThis & {
        __baxterConversationMemory?: {
          messages: Map<
            string,
            Array<{ id: string; role: string; content: string; created_at: string }>
          >;
        };
      }
    ).__baxterConversationMemory;
    const list = mem?.messages.get(conversation.id);
    const user = list?.find((m) => m.role === "user");
    const asst = list?.find((m) => m.id === assistant.id);
    if (user) {
      user.content = longQ;
      // Must be ≤ assistant created_at for enrichInquiries to attach the question.
      user.created_at = "2026-07-05T11:59:00.000Z";
    }
    if (asst) asst.content = longA;

    const listed = await listInquiriesForAdmin({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
    });
    const row = listed.rows.find((r) => r.messageId === assistant.id);
    expect(row?.questionText).toBe(longQ);
    expect(row?.answerText).toBe(longA);
    expect(row?.questionExcerpt).toBe(longQ.slice(0, 200));
    expect(row?.answerExcerpt).toBe(longA.slice(0, 240));
    expect(row!.questionExcerpt.length).toBeLessThan(row!.questionText.length);
    expect(row!.answerExcerpt.length).toBeLessThan(row!.answerText.length);
  });
});

describe("date-range preset links reuse resolveFeedbackDateRange", () => {
  it("each preset link value resolves identically to the prior dropdown presets", () => {
    const now = zonedLocalToUtc(2026, 7, 15, 15, 0, 0);
    for (const { value } of FEEDBACK_RANGE_PRESET_LINKS) {
      const viaLink = resolveFeedbackDateRange({ preset: value, now });
      const viaDropdown = resolveFeedbackDateRange({ preset: value, now });
      expect(viaLink).toEqual(viaDropdown);
    }
  });
});
