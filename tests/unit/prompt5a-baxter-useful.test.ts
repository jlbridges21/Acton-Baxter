import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { createKnowledgeEntry, resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { scoreKnowledgeMatch, normalizeSearchText } from "@/lib/knowledge/retrieval";
import { classifyBaxterQuestion } from "@/lib/baxter-ai/classify";
import { answerFromBaxterIdentity } from "@/lib/baxter-ai/identity";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { parseBaxterLlmOutputLenient } from "@/lib/baxter-ai/schemas";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { bootstrapBaxterOverviewEntry } from "@/lib/baxter-ai/diagnostics";
import type { KnowledgeEntry } from "@/lib/knowledge/types";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.OPENAI_API_KEY = "";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
  resetBaxterConversationMemoryForTests();
});

function briefEntry(
  overrides: Partial<KnowledgeEntry> = {},
): Parameters<typeof createKnowledgeEntry>[0] {
  return {
    title: "Baxter Project Brief",
    content: [
      "# Baxter Project Brief",
      "",
      "Baxter is Acton ADU’s first digital employee.",
      "Baxter is Acton ADU’s proprietary AI operations agent.",
      "Baxter is a Slack-native teammate and knowledge keeper.",
      "In Phase 1, Baxter should not invent policies or access live Buildertrend data.",
      "Baxter will eventually connect to Google Drive, GoHighLevel, Buildertrend, and Domo.",
    ].join("\n"),
    summary: "Overview of Baxter",
    category: "Baxter",
    tags: ["baxter", "overview"],
    source_name: "Project Brief",
    source_type: "manual",
    visibility: "internal",
    status: "approved",
    ...overrides,
  };
}

describe("Prompt 5A retrieval", () => {
  it("retrieves Project Brief for Who is Baxter despite curly apostrophes and markdown", async () => {
    const created = await createKnowledgeEntry(briefEntry(), "admin-1");
    const results = await searchApprovedKnowledge({ query: "Who is Baxter?" });
    expect(results.some((row) => row.id === created.id)).toBe(true);
    expect(normalizeSearchText("Acton ADU’s")).toContain("acton adu's");
  });

  it("ranks title matches above distant body matches", () => {
    const titled = {
      title: "PTO Policy",
      content: "misc",
      summary: null,
      category: "HR",
      tags: [],
      source_name: null,
    } as unknown as KnowledgeEntry;
    const buried = {
      title: "Other",
      content: "something about pto buried here",
      summary: null,
      category: "HR",
      tags: [],
      source_name: null,
    } as unknown as KnowledgeEntry;
    expect(scoreKnowledgeMatch(titled as KnowledgeEntry, "pto")).toBeGreaterThan(
      scoreKnowledgeMatch(buried as KnowledgeEntry, "pto"),
    );
  });
});

describe("Prompt 5A classification and identity", () => {
  it("classifies common intents", () => {
    expect(classifyBaxterQuestion("Who is Baxter?")).toBe("baxter_identity");
    expect(classifyBaxterQuestion("What can you do?")).toBe("baxter_identity");
    expect(classifyBaxterQuestion("What is our feasibility process?")).toBe(
      "acton_process_specific",
    );
    expect(classifyBaxterQuestion("What is an ADU?")).toBe("general_knowledge");
    expect(classifyBaxterQuestion("Help me write an email")).toBe("general_knowledge");
    expect(classifyBaxterQuestion("Tell me more")).toBe("conversational");
  });

  it("answers identity questions with empty Knowledge Base and no OpenAI key", async () => {
    const result = await answerBaxterQuestion({
      question: "Who is Baxter?",
      userId: "00000000-0000-4000-8000-000000000099",
      userName: "Test",
      channel: "web",
    });
    expect(result.answerMode).toBe("identity");
    expect(result.answer.toLowerCase()).toContain("acton");
    expect(result.sources).toEqual([]);
    expect(answerFromBaxterIdentity("What can you do?").toLowerCase()).toContain("help");
  });

  it("bootstrap overview is idempotent", async () => {
    const first = await bootstrapBaxterOverviewEntry("00000000-0000-4000-8000-000000000001");
    const second = await bootstrapBaxterOverviewEntry("00000000-0000-4000-8000-000000000001");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.entryId).toBe(first.entryId);
  });
});

describe("Prompt 5A parsing resilience", () => {
  it("keeps valid text when structured metadata is incomplete", () => {
    const raw = JSON.stringify({
      answer: "Baxter is Acton ADU’s internal AI assistant.",
      usedSourceNumbers: [],
    });
    const parsed = parseBaxterLlmOutputLenient(raw);
    expect(parsed.structured?.answer).toContain("Baxter");
  });

  it("falls back to plain text when JSON is broken", () => {
    const parsed = parseBaxterLlmOutputLenient("Baxter is ready to help.");
    expect(parsed.textFallback).toContain("Baxter is ready");
  });
});
