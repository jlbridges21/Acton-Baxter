import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  createKnowledgeEntry,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
  updateKnowledgeEntry,
} from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { resetBaxterConversationMemoryForTests } from "@/lib/baxter-ai/conversations";
import { mapUsedSourceNumbers, isSafeHttpUrl } from "@/lib/baxter-ai/citations";
import { parseBaxterLlmJson } from "@/lib/baxter-ai/schemas";
import { toBaxterContextItems } from "@/lib/baxter-ai/context";
import { OpenAIBaxterProvider, getBaxterLlmProvider } from "@/lib/baxter-ai/openai-provider";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.BAXTER_CHAT_ENABLED = "true";
  process.env.BAXTER_LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
  resetBaxterConversationMemoryForTests();
});

describe("Baxter AI grounding and citations", () => {
  it("excludes draft, archived, and admin-only from approved retrieval used by Baxter", async () => {
    const approved = await createKnowledgeEntry(
      {
        title: "PEM Preparation Process",
        content: "After signing, schedule the PEM with the customer.",
        summary: "PEM steps",
        category: "Sales Process",
        tags: ["pem"],
        source_name: "Sales Playbook",
        source_type: "manual",
        visibility: "internal",
        status: "approved",
      },
      "admin-1",
    );

    await createKnowledgeEntry(
      {
        title: "Draft Only",
        content: "Should not appear in retrieval results at all.",
        category: "Sales Process",
        tags: ["pem"],
        source_type: "manual",
        visibility: "internal",
        status: "draft",
      },
      "admin-1",
    );

    await createKnowledgeEntry(
      {
        title: "Admin Secret",
        content: "Internal payroll procedure should stay admin only.",
        category: "HR",
        tags: ["payroll"],
        source_type: "manual",
        visibility: "admin_only",
        status: "approved",
      },
      "admin-1",
    );

    const results = await searchApprovedKnowledge({ query: "PEM preparation" });
    expect(results.some((row) => row.id === approved.id)).toBe(true);
    expect(results.some((row) => row.title === "Draft Only")).toBe(false);
    expect(results.some((row) => row.title === "Admin Secret")).toBe(false);
  });

  it("maps only real retrieved source numbers and rejects unsafe URLs", () => {
    const context = toBaxterContextItems([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Site Inspection Checklist",
        summary: null,
        contentExcerpt: "Inspect the site.",
        category: "Production SOP",
        tags: ["inspection"],
        sourceName: "Ops",
        sourceUrl: "javascript:alert(1)",
        sourceType: "manual",
        mimeType: null,
        updatedAt: new Date().toISOString(),
        relevanceScore: 10,
        citationLabel: "Production SOP — Site Inspection Checklist",
      },
    ]);

    const sources = mapUsedSourceNumbers([1, 99, 1], context);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe("Site Inspection Checklist");
    expect(sources[0]?.sourceUrl).toBe("/knowledge/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(isSafeHttpUrl("https://example.com/doc")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("returns insufficientKnowledge when no approved knowledge matches", async () => {
    const result = await answerBaxterQuestion({
      question: "What is the RACI for a made-up process that does not exist?",
      userId: "00000000-0000-4000-8000-000000000099",
      userName: "Test User",
      channel: "web",
    });
    expect(result.insufficientKnowledge).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.answer.toLowerCase()).toContain("approved acton source");
    expect(result.conversationId).toBeTruthy();
  });

  it("validates structured OpenAI-like JSON and rejects malformed payloads", () => {
    const ok = parseBaxterLlmJson(
      JSON.stringify({
        answer: "Follow the PEM checklist.",
        usedSourceNumbers: [1],
        confidence: "high",
        insufficientKnowledge: false,
      }),
    );
    expect(ok.usedSourceNumbers).toEqual([1]);
    expect(() => parseBaxterLlmJson("not-json")).toThrow();
  });

  it("exposes OpenAIBaxterProvider and does not claim Anthropic is implemented", () => {
    const provider = new OpenAIBaxterProvider("gpt-4o-mini");
    expect(provider.key).toBe("openai");
    process.env.BAXTER_LLM_PROVIDER = "anthropic";
    resetEnvCacheForTests();
    expect(() => getBaxterLlmProvider()).toThrow(/Anthropic is planned/i);
  });

  it("chat launcher is dashboard-only and feature-flagged", () => {
    const home = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    const dashboard = readFileSync(
      path.join(process.cwd(), "src/components/baxter/baxter-dashboard.tsx"),
      "utf8",
    );
    const reportsNew = readFileSync(
      path.join(process.cwd(), "src/app/reports/new/page.tsx"),
      "utf8",
    );
    const adminKnowledge = readFileSync(
      path.join(process.cwd(), "src/app/admin/knowledge/page.tsx"),
      "utf8",
    );
    expect(home).toMatch(/chatEnabled/);
    expect(dashboard).toMatch(/BaxterChatLauncher/);
    expect(dashboard).toMatch(/chatEnabled \? <BaxterChatLauncher/);
    expect(reportsNew).not.toMatch(/BaxterChatLauncher/);
    expect(adminKnowledge).not.toMatch(/BaxterChatLauncher/);
  });

  it("editing approved knowledge returns entry to draft so Baxter cannot use it until re-approved", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Feasibility Package Follow-up",
        content: "Original content for the feasibility package process.",
        category: "Sales Process",
        tags: ["feasibility"],
        source_type: "manual",
        visibility: "internal",
        status: "approved",
      },
      "admin-1",
    );
    expect(entry.status).toBe("approved");

    const updated = await updateKnowledgeEntry(
      entry.id,
      {
        title: "Feasibility Package Follow-up",
        content: "Changed procedure body for the feasibility package process.",
        category: "Sales Process",
        tags: ["feasibility"],
        source_type: "manual",
        visibility: "internal",
        change_note: "Revised steps",
      },
      "admin-1",
    );
    expect(updated.status).toBe("draft");

    const results = await searchApprovedKnowledge({ query: "Feasibility Package" });
    expect(results.some((row) => row.id === entry.id)).toBe(false);

    await setKnowledgeEntryStatus(entry.id, "approved", "admin-1");
    const afterApprove = await searchApprovedKnowledge({ query: "Feasibility Package" });
    expect(afterApprove.some((row) => row.id === entry.id)).toBe(true);
  });
});
