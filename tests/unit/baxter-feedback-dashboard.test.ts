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

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetBaxterConversationMemoryForTests();
  resetBaxterFeedbackMemoryForTests();
});

describe("resolveFeedbackDateRange", () => {
  it("resolves this_week as Monday 00:00 Pacific through now", () => {
    // Wednesday 2026-07-15 15:00 PDT
    const now = zonedLocalToUtc(2026, 7, 15, 15, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "this_week", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 7, 13, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(now.toISOString());
  });

  it("resolves this_month from the 1st through now", () => {
    const now = zonedLocalToUtc(2026, 8, 3, 11, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "this_month", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 8, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(now.toISOString());
  });

  it("resolves last_month as the full previous calendar month", () => {
    const now = zonedLocalToUtc(2026, 8, 3, 11, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "last_month", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 7, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(zonedLocalToUtc(2026, 7, 31, 23, 59, 59).toISOString());
  });

  it("resolves last_month correctly in January (previous year)", () => {
    const now = zonedLocalToUtc(2026, 1, 10, 9, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "last_month", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2025, 12, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(zonedLocalToUtc(2025, 12, 31, 23, 59, 59).toISOString());
  });

  it("resolves this_year from Jan 1 through now", () => {
    const now = zonedLocalToUtc(2026, 8, 3, 11, 0, 0);
    const bounds = resolveFeedbackDateRange({ preset: "this_year", now });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 1, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(now.toISOString());
  });

  it("resolves last_7_days and last_30_days inclusively through now", () => {
    const now = zonedLocalToUtc(2026, 8, 10, 12, 0, 0);
    const d7 = resolveFeedbackDateRange({ preset: "last_7_days", now });
    const d30 = resolveFeedbackDateRange({ preset: "last_30_days", now });
    expect(d7.start).toBe(zonedLocalToUtc(2026, 8, 4, 0, 0, 0).toISOString());
    expect(d30.start).toBe(zonedLocalToUtc(2026, 7, 12, 0, 0, 0).toISOString());
    expect(d7.end).toBe(now.toISOString());
    expect(d30.end).toBe(now.toISOString());
  });

  it("returns unbounded bounds for all_time", () => {
    expect(resolveFeedbackDateRange({ preset: "all_time" })).toEqual({
      start: null,
      end: null,
    });
  });

  it("resolves custom dates as inclusive Pacific days", () => {
    const bounds = resolveFeedbackDateRange({
      preset: "custom",
      customStart: "2026-03-01",
      customEnd: "2026-03-15",
    });
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 3, 1, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(zonedLocalToUtc(2026, 3, 15, 23, 59, 59).toISOString());
  });

  it("handles a DST spring-forward crossing for last_7_days in Pacific time", () => {
    // US Pacific DST starts 2026-03-08 02:00 → 03:00. Pin "now" after the jump.
    const now = zonedLocalToUtc(2026, 3, 10, 15, 0, 0);
    const ymd = getZonedYmd(now, BAXTER_REPORTING_TIMEZONE);
    expect(ymd).toMatchObject({ year: 2026, month: 3, day: 10 });

    const bounds = resolveFeedbackDateRange({ preset: "last_7_days", now });
    // 10 − 6 days = March 4 00:00 PST (still standard time)
    expect(bounds.start).toBe(zonedLocalToUtc(2026, 3, 4, 0, 0, 0).toISOString());
    expect(bounds.end).toBe(now.toISOString());

    // Start should be midnight Pacific: offset UTC-8 before DST.
    expect(bounds.start).toBe("2026-03-04T08:00:00.000Z");
    // Now is 15:00 PDT (UTC-7) on Mar 10.
    expect(bounds.end).toBe("2026-03-10T22:00:00.000Z");
  });
});

async function seedInquiry(input: {
  channel: "web" | "slack";
  createdAt: string;
  userId?: string;
  rate?: "up" | "down" | null;
}) {
  const conversation = await getOrCreateConversation({
    userId:
      input.channel === "web" ? (input.userId ?? "00000000-0000-4000-8000-000000000001") : null,
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
  // Overwrite created_at in memory for range tests
  const mem = (
    globalThis as typeof globalThis & {
      __baxterConversationMemory?: {
        messages: Map<string, Array<{ id: string; created_at: string; role: string }>>;
      };
    }
  ).__baxterConversationMemory;
  const list = mem?.messages.get(conversation.id);
  const row = list?.find((m) => m.id === assistant.id);
  if (row) row.created_at = input.createdAt;

  if (input.rate === "up" || input.rate === "down") {
    if (input.channel === "web") {
      const feedback = await upsertMessageFeedback({
        messageId: assistant.id,
        conversationId: conversation.id,
        userId: input.userId ?? "00000000-0000-4000-8000-000000000001",
        rating: input.rate,
      });
      const fbMem = (
        globalThis as typeof globalThis & {
          __baxterFeedbackMemory?: {
            feedback: Map<string, { id: string; created_at: string }>;
          };
        }
      ).__baxterFeedbackMemory;
      for (const [key, fb] of fbMem?.feedback.entries() ?? []) {
        if (fb.id === feedback.id) {
          fbMem!.feedback.set(key, { ...fb, created_at: input.createdAt });
        }
      }
    } else {
      const feedback = await upsertSlackMessageFeedback({
        messageId: assistant.id,
        conversationId: conversation.id,
        slackUserId: "U_REACTOR",
        slackTeamId: "T1",
        rating: input.rate,
      });
      const fbMem = (
        globalThis as typeof globalThis & {
          __baxterFeedbackMemory?: {
            feedback: Map<string, { id: string; created_at: string }>;
          };
        }
      ).__baxterFeedbackMemory;
      for (const [key, fb] of fbMem?.feedback.entries() ?? []) {
        if (fb.id === feedback.id) {
          fbMem!.feedback.set(key, { ...fb, created_at: input.createdAt });
        }
      }
    }
  }

  return { conversation, assistant };
}

describe("getBaxterInquiryCount", () => {
  it("counts assistant messages in bounded and unbounded ranges", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-01T12:00:00.000Z",
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-15T12:00:00.000Z",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-08-01T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000002",
    });

    const all = await getBaxterInquiryCount({ start: null, end: null });
    expect(all.total).toBe(3);
    expect(all.byChannel).toEqual({ web: 2, slack: 1 });

    const july = await getBaxterInquiryCount({
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-31T23:59:59.999Z",
    });
    expect(july.total).toBe(2);
    expect(july.byChannel).toEqual({ web: 1, slack: 1 });
  });
});

describe("getFeedbackDashboard", () => {
  it("combines date range, rating, sort, pagination and floors noFeedbackCount", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-05T12:00:00.000Z",
      rate: "up",
    });
    await seedInquiry({
      channel: "slack",
      createdAt: "2026-07-10T12:00:00.000Z",
      rate: "down",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-07-20T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000003",
      rate: null,
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-08-05T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000004",
      rate: "up",
    });

    const july = await getFeedbackDashboard({
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
      rating: "all",
      sort: "oldest",
      limit: 50,
      offset: 0,
    });

    expect(july.totalInquiries).toBe(3);
    expect(july.positiveCount).toBe(1);
    expect(july.negativeCount).toBe(1);
    expect(july.noFeedbackCount).toBe(1);
    expect(july.totalMatchingRows).toBe(2);
    expect(july.rows.map((r) => r.rating)).toEqual(["up", "down"]);
    expect(july.channelBreakdown).toEqual({ web: 2, slack: 1 });

    const downs = await getFeedbackDashboard({
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
      rating: "down",
      sort: "newest",
    });
    expect(downs.rows).toHaveLength(1);
    expect(downs.rows[0]?.rating).toBe("down");
    // Summary counts stay range-wide (not limited to the list rating filter).
    expect(downs.positiveCount).toBe(1);
    expect(downs.negativeCount).toBe(1);

    const overRated = await getFeedbackDashboard({
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-05T23:59:59.999Z",
      },
    });
    // 1 inquiry, 1 positive → noFeedback 0
    expect(overRated.noFeedbackCount).toBe(0);
    expect(overRated.noFeedbackCount).toBeGreaterThanOrEqual(0);
  });
});

describe("listFeedbackForAdmin defaults", () => {
  it("defaults to all-time newest-first when no range is passed", async () => {
    await seedInquiry({
      channel: "web",
      createdAt: "2026-01-01T12:00:00.000Z",
      rate: "down",
    });
    await seedInquiry({
      channel: "web",
      createdAt: "2026-06-01T12:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000005",
      rate: "up",
    });

    const listed = await listFeedbackForAdmin({ rating: "all" });
    expect(listed.totalMatching).toBe(2);
    expect(listed.positiveCount).toBe(1);
    expect(listed.negativeCount).toBe(1);
    expect(listed.rows[0]?.rating).toBe("up");
  });
});
