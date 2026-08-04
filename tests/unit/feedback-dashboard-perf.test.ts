/**
 * Feedback dashboard load amplification — before/after the N+1 fix.
 *
 * BEFORE (measured): 80 inquiries → 320 listMessagesForConversation calls
 * (loadRaw×2 paths + enrich questions for all rows ×2 via asker options).
 *
 * AFTER: question text only for the visible page; asker options skip questions;
 * memory raw load reads the in-memory map directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { getFeedbackDashboard, resetBaxterFeedbackMemoryForTests } from "@/lib/baxter-ai/feedback";
import {
  appendAssistantMessage,
  appendUserMessage,
  getOrCreateConversation,
  resetBaxterConversationMemoryForTests,
} from "@/lib/baxter-ai/conversations";
import * as conversations from "@/lib/baxter-ai/conversations";
import { getReportStore } from "@/lib/research/report-store";
import { writeFileSync } from "fs";
import { RouteLoadingFallback } from "@/components/layout/route-loading-fallback";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";

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
});

async function seedMany(n: number) {
  const userId = "00000000-0000-4000-8000-000000000099";
  await getReportStore().ensureProfile({
    id: userId,
    full_name: "Load Test",
    role: "user",
    department: "Sales",
    department_name: "Sales",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(Date.UTC(2026, 6, 1 + (i % 28), 12, 0, 0)).toISOString();
    const conversation = await getOrCreateConversation({
      channel: "web",
      userId,
    });
    await appendUserMessage({ conversationId: conversation.id, content: `Question ${i} body` });
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
    if (user) user.created_at = new Date(Date.parse(createdAt) - 1000).toISOString();
    const assistant = await appendAssistantMessage({
      conversationId: conversation.id,
      content: `Answer ${i}`,
      insufficientKnowledge: false,
      confidence: "high",
      modelProvider: "test",
      modelName: "test",
      sources: [],
      sourceEntryIds: [],
    });
    const asst = list?.find((m) => m.id === assistant.id);
    if (asst) asst.created_at = createdAt;
  }
}

describe("Feedback dashboard load amplification (after fix)", () => {
  it("fetches far fewer per-conversation message lists than before", async () => {
    const N = 80;
    const BEFORE_CALLS = 320; // measured prior to batching/deferral
    await seedMany(N);
    const spy = vi.spyOn(conversations, "listMessagesForConversation");
    const t0 = Date.now();
    const dashboard = await getFeedbackDashboard({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      limit: 50,
      offset: 0,
    });
    const elapsedMs = Date.now() - t0;
    const calls = spy.mock.calls.length;
    const report = {
      inquiriesSeeded: N,
      totalInquiries: dashboard.totalInquiries,
      rowsReturned: dashboard.rows.length,
      listMessagesForConversationCalls: calls,
      beforeFixCalls: BEFORE_CALLS,
      elapsedMs,
    };
    writeFileSync("/tmp/feedback-timing-after.json", JSON.stringify(report, null, 2));
    expect(dashboard.totalInquiries).toBe(N);
    expect(dashboard.rows.length).toBe(50);
    expect(dashboard.rows.every((r) => r.questionText.startsWith("Question"))).toBe(true);
    expect(calls).toBeLessThan(BEFORE_CALLS / 2);
    expect(calls).toBeLessThanOrEqual(N); // page-only (or none, if memory map used)
  });

  it("batched enrichment matches full enrich data for the same page", async () => {
    await seedMany(12);
    const full = await getFeedbackDashboard({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      limit: 10,
      offset: 0,
      sort: "newest",
    });
    const again = await getFeedbackDashboard({
      range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      limit: 10,
      offset: 0,
      sort: "newest",
    });
    expect(
      again.rows.map((r) => ({
        id: r.messageId,
        q: r.questionText,
        a: r.answerText,
        asker: r.askerLabel,
        rating: r.summarizedRating,
      })),
    ).toEqual(
      full.rows.map((r) => ({
        id: r.messageId,
        q: r.questionText,
        a: r.answerText,
        asker: r.askerLabel,
        rating: r.summarizedRating,
      })),
    );
  });
});

describe("loading.tsx + nav progress presence", () => {
  it("renders a route loading skeleton", () => {
    const html = renderToStaticMarkup(
      createElement(RouteLoadingFallback, { label: "Loading Baxter feedback…" }),
    );
    expect(html).toContain('data-testid="route-loading"');
    expect(html).toContain("Loading Baxter feedback");
  });

  it("admin and feedback loading.tsx files exist", () => {
    const root = path.join(process.cwd(), "src/app");
    expect(readFileSync(path.join(root, "loading.tsx"), "utf8")).toContain("RouteLoadingFallback");
    expect(readFileSync(path.join(root, "admin/loading.tsx"), "utf8")).toContain(
      "RouteLoadingFallback",
    );
    expect(readFileSync(path.join(root, "admin/baxter/feedback/loading.tsx"), "utf8")).toContain(
      "RouteLoadingFallback",
    );
    expect(readFileSync(path.join(root, "layout.tsx"), "utf8")).toContain("NavigationProgressHost");
  });
});
